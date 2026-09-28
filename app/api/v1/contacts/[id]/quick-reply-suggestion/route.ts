import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { inferirSugestaoRespostaRapida } from "@/lib/inbox/sugestao-resposta-rapida";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function jsonObjeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "message_templates" });
  if (!authz.ok) return authz.response;
  const { id: contactId } = await ctx.params;
  const supabase = await createClient();

  const { data: contato, error: contatoError } = await supabase
    .from("contacts")
    .select("id")
    .eq("organization_id", authz.org.orgId)
    .eq("id", contactId)
    .maybeSingle();
  if (contatoError) return fail("internal_error", contatoError.message, 500, { requestId });
  if (!contato) return fail("not_found", "Contato não encontrado.", 404, { requestId });

  const [negocios, tarefas, compromissos] = await Promise.all([
    supabase
      .from("crm_leads")
      .select(
        "id, status, source, custom_fields, last_activity_at, updated_at, closed_at, crm_stages(name)",
      )
      .eq("organization_id", authz.org.orgId)
      .eq("contact_id", contactId)
      .order("updated_at", { ascending: false })
      .limit(8),
    supabase
      .from("crm_tasks")
      .select("id, title, status")
      .eq("organization_id", authz.org.orgId)
      .eq("contact_id", contactId)
      .in("status", ["pending", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("calendar_appointments")
      .select("id, status, outcome_recorded_at")
      .eq("organization_id", authz.org.orgId)
      .eq("contact_id", contactId)
      .not("outcome_recorded_at", "is", null)
      .order("outcome_recorded_at", { ascending: false })
      .limit(5),
  ]);

  const erro = negocios.error ?? tarefas.error ?? compromissos.error;
  if (erro) return fail("internal_error", erro.message, 500, { requestId });

  const linhasNegocio = (negocios.data ?? []) as Array<{
    status: string;
    source: string | null;
    custom_fields: unknown;
    last_activity_at: string | null;
    updated_at: string | null;
    closed_at: string | null;
    crm_stages: unknown;
  }>;

  const financeiros = linhasNegocio.flatMap((negocio) => {
    const campos = jsonObjeto(negocio.custom_fields);
    const statusPagamento = texto(campos.status_pagamento);
    const renovaEm = texto(campos.renova_em);
    const ehBilling = negocio.source?.startsWith("periciaia_billing") ?? false;
    return ehBilling || statusPagamento || renovaEm
      ? [
          {
            source: negocio.source,
            statusPagamento,
            renovaEm,
          },
        ]
      : [];
  });

  const sugestao = inferirSugestaoRespostaRapida({
    agora: new Date(),
    financeiros,
    tarefasAbertas: (tarefas.data ?? []).map((tarefa) => ({ title: tarefa.title })),
    compromissosRecentes: (compromissos.data ?? []).map((compromisso) => ({
      status: compromisso.status,
      outcomeRecordedAt: compromisso.outcome_recorded_at,
    })),
    negocios: linhasNegocio.map((negocio) => {
      const embed = Array.isArray(negocio.crm_stages) ? negocio.crm_stages[0] : negocio.crm_stages;
      const etapaNome = texto((embed as { name?: unknown } | null)?.name);
      return {
        status: negocio.status,
        source: negocio.source,
        etapaNome,
        lastActivityAt: negocio.last_activity_at,
        updatedAt: negocio.updated_at,
        closedAt: negocio.closed_at,
      };
    }),
  });

  return ok({ suggestion: sugestao }, { requestId });
}
