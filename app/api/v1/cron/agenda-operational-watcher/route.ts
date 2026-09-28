import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import {
  idDaTarefaAutomaticaDaAgenda,
  pendenciaOperacionalDaAgenda,
  type TipoDePendenciaDaAgenda,
} from "@/lib/agenda/pendencias-operacionais";
import { env } from "@/lib/env";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { resolveActiveLeadForContact, type LeadCandidate } from "@/lib/leads/active-lead";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const LIMITE = 500;
const JANELA_MS = 30 * 24 * 60 * 60_000;

type Compromisso = {
  id: string;
  organization_id: string;
  title: string;
  contact_id: string | null;
  owner_user_id: string | null;
  status: string;
  ends_at: string;
  outcome_recorded_at: string | null;
};

type Lead = LeadCandidate & { contact_id: string | null };

function chave(org: string, contato: string): string {
  return `${org}:${contato}`;
}

function tituloDaTarefa(compromisso: Compromisso, tipo: TipoDePendenciaDaAgenda): string {
  if (tipo === "registrar_resultado") return `Registrar resultado: ${compromisso.title}`;
  return compromisso.status === "no_show"
    ? `Definir próximo passo após falta: ${compromisso.title}`
    : `Definir próximo passo: ${compromisso.title}`;
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const auth = req.headers.get("authorization") ?? "";
  const fornecido = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const aceitos = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (aceitos.length === 0 || !fornecido || !aceitos.includes(fornecido)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();
  const agora = new Date();
  const desde = new Date(agora.getTime() - JANELA_MS).toISOString();

  const { data, error } = await admin
    .from("calendar_appointments")
    .select(
      "id, organization_id, title, contact_id, owner_user_id, status, ends_at, outcome_recorded_at",
    )
    .not("contact_id", "is", null)
    .in("status", ["pending", "confirmed", "completed", "no_show"])
    .gte("ends_at", desde)
    .lte("ends_at", agora.toISOString())
    .order("ends_at", { ascending: false })
    .limit(LIMITE);

  if (error) {
    logger.error("[agenda-operational-watcher] consulta falhou", { error: error.message, requestId });
    return fail("internal_error", "Falha ao buscar compromissos.", 500, { requestId });
  }

  const compromissos = (data ?? []) as Compromisso[];
  if (compromissos.length === 0) {
    return ok({ examinados: 0, criadas: 0, resultados_fechados: 0 }, { requestId });
  }

  const idsDeResultadoResolvido = compromissos
    .filter((c) => c.outcome_recorded_at && ["completed", "no_show"].includes(c.status))
    .map((c) => idDaTarefaAutomaticaDaAgenda(c.id, "registrar_resultado"));
  let resultadosFechados = 0;
  if (idsDeResultadoResolvido.length > 0) {
    const { data: fechadas, error: fecharError } = await admin
      .from("crm_tasks")
      .update({ status: "done" })
      .in("id", idsDeResultadoResolvido)
      .in("status", ["pending", "in_progress"])
      .select("id");
    if (fecharError) {
      logger.error("[agenda-operational-watcher] fechamento de tarefas falhou", {
        error: fecharError.message,
        requestId,
      });
      return fail("internal_error", "Falha ao reconciliar tarefas da agenda.", 500, { requestId });
    }
    resultadosFechados = fechadas?.length ?? 0;
  }

  const contatos = [...new Set(compromissos.flatMap((c) => (c.contact_id ? [c.contact_id] : [])))];
  const donos = [...new Set(compromissos.flatMap((c) => (c.owner_user_id ? [c.owner_user_id] : [])))];
  const orgs = [...new Set(compromissos.map((c) => c.organization_id))];

  const [tarefasAbertas, leadsAbertos, membrosAtivos] = await Promise.all([
    contatos.length
      ? admin
          .from("crm_tasks")
          .select("id, organization_id, contact_id")
          .in("contact_id", contatos)
          .in("status", ["pending", "in_progress"])
      : Promise.resolve({ data: [], error: null }),
    contatos.length
      ? admin
          .from("crm_leads")
          .select("id, organization_id, contact_id, pipeline_id, status, last_activity_at, created_at")
          .in("contact_id", contatos)
          .eq("status", "open")
      : Promise.resolve({ data: [], error: null }),
    donos.length
      ? admin
          .from("user_organizations")
          .select("organization_id, user_id, role")
          .in("organization_id", orgs)
          .in("user_id", donos)
          .is("revoked_at", null)
          .neq("role", "viewer")
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (tarefasAbertas.error || leadsAbertos.error || membrosAtivos.error) {
    logger.error("[agenda-operational-watcher] contexto falhou", {
      tarefas: tarefasAbertas.error?.message,
      leads: leadsAbertos.error?.message,
      membros: membrosAtivos.error?.message,
      requestId,
    });
    return fail("internal_error", "Falha ao montar contexto operacional.", 500, { requestId });
  }

  const contatosComTarefa = new Set<string>();
  for (const tarefa of tarefasAbertas.data ?? []) {
    if (tarefa.contact_id) contatosComTarefa.add(chave(tarefa.organization_id, tarefa.contact_id));
  }

  const leadsPorContato = new Map<string, Lead[]>();
  for (const lead of (leadsAbertos.data ?? []) as Lead[]) {
    if (!lead.contact_id) continue;
    const k = chave(lead.organization_id, lead.contact_id);
    const lista = leadsPorContato.get(k);
    if (lista) lista.push(lead);
    else leadsPorContato.set(k, [lead]);
  }

  const membros = new Set(
    (membrosAtivos.data ?? []).map((m) => `${m.organization_id}:${m.user_id}`),
  );

  const linhas: Array<{
    id: string;
    organization_id: string;
    title: string;
    description: string;
    due_date: string;
    priority: "high";
    status: "pending";
    lead_id: string | null;
    contact_id: string;
    assigned_to: string | null;
    created_by: null;
  }> = [];

  for (const compromisso of compromissos) {
    if (!compromisso.contact_id) continue;
    const k = chave(compromisso.organization_id, compromisso.contact_id);
    const tipo = pendenciaOperacionalDaAgenda({
      compromisso,
      agora,
      temTarefaAbertaDoContato: contatosComTarefa.has(k),
    });
    if (!tipo) continue;

    const candidatos = leadsPorContato.get(k) ?? [];
    const alvo = resolveActiveLeadForContact(candidatos);
    const leadId = alvo.routed ? alvo.leadId : null;
    const responsavel =
      compromisso.owner_user_id && membros.has(`${compromisso.organization_id}:${compromisso.owner_user_id}`)
        ? compromisso.owner_user_id
        : null;

    linhas.push({
      id: idDaTarefaAutomaticaDaAgenda(compromisso.id, tipo),
      organization_id: compromisso.organization_id,
      title: tituloDaTarefa(compromisso, tipo),
      description:
        tipo === "registrar_resultado"
          ? "Gerada automaticamente pela Agenda porque o horário terminou sem registro de comparecimento ou falta."
          : "Gerada automaticamente pela Agenda porque o compromisso terminou e o cliente ficou sem uma tarefa de próximo passo.",
      due_date: agora.toISOString(),
      priority: "high",
      status: "pending",
      lead_id: leadId,
      contact_id: compromisso.contact_id,
      assigned_to: responsavel,
      created_by: null,
    });
  }

  if (linhas.length === 0) {
    return ok(
      { examinados: compromissos.length, criadas: 0, resultados_fechados: resultadosFechados },
      { requestId },
    );
  }

  const { data: criadas, error: insertError } = await admin
    .from("crm_tasks")
    .upsert(linhas, { onConflict: "id", ignoreDuplicates: true })
    .select("id, organization_id, lead_id, contact_id, title, due_date, priority");
  if (insertError) {
    logger.error("[agenda-operational-watcher] criação de tarefas falhou", {
      error: insertError.message,
      requestId,
    });
    return fail("internal_error", "Falha ao criar tarefas operacionais.", 500, { requestId });
  }

  const novas = criadas ?? [];
  for (const tarefa of novas) {
    if (!tarefa.lead_id) continue;
    await emitLeadActivity(admin, {
      organizationId: tarefa.organization_id,
      leadId: tarefa.lead_id,
      contactId: tarefa.contact_id,
      type: "task_created",
      sourceModule: "agenda",
      sourceId: tarefa.id,
      actor: { type: "api_token", id: "agenda-operational-watcher" },
      reason: tarefa.title.slice(0, 200),
      payload: { due_date: tarefa.due_date, priority: tarefa.priority, automatic: true },
    });
  }

  const criadasPorOrg = new Map<string, number>();
  for (const tarefa of novas) {
    criadasPorOrg.set(tarefa.organization_id, (criadasPorOrg.get(tarefa.organization_id) ?? 0) + 1);
  }
  for (const [organizationId, quantidade] of criadasPorOrg) {
    await audit({
      action: "crm_task.created",
      organizationId,
      resourceType: "crm_tasks",
      requestId,
      metadata: { quantidade },
    });
  }

  return ok(
    {
      examinados: compromissos.length,
      criadas: novas.length,
      resultados_fechados: resultadosFechados,
    },
    { requestId },
  );
}

export const GET = handle;
export const POST = handle;
