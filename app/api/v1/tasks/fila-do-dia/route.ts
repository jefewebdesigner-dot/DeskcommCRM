/**
 * GET /api/v1/tasks/fila-do-dia — a fila TRAVADA do dia, por responsável.
 *
 * Diferente de `GET /api/v1/tasks?limite=20`: aquele recalcula a cada
 * chamada — concluir uma tarefa "puxa" a próxima na hora. Esta rota MATERIALIZA
 * a seleção na primeira chamada do dia (grava em `crm_task_daily_queue`) e
 * toda chamada seguinte, no mesmo dia local da organização, devolve o MESMO
 * conjunto de tarefas, não importa quantas foram concluídas nesse meio tempo.
 * É o pedido real: "a tela recusa mostrar a 21ª até o dia virar".
 *
 * ORDEM da seleção (só na primeira materialização do dia): prioridade
 * primeiro (urgent > high > medium > low), prazo em segundo — "focar nas mais
 * importantes" vence "focar na mais antiga".
 *
 * Primeira chamada do dia é ESCRITA (grava o snapshot) — por isso o piso é
 * `agent`, igual à mutação de tarefas, não `viewer` como a listagem comum.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";
import type { PrioridadeDaTarefa, Tarefa } from "@/lib/tarefas/tipos";
import { responsavelDaTarefaExiste } from "@/lib/tarefas/responsaveis";

export const dynamic = "force-dynamic";

const TETO_DA_FILA = 20;

/** Menor número = mais importante. `?? 9` empurra prioridade desconhecida pro fim, nunca pro topo. */
const RANK_DA_PRIORIDADE: Record<PrioridadeDaTarefa, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const COLUNAS_TAREFA =
  "id, organization_id, title, description, due_date, priority, status, lead_id, contact_id, assigned_to, responsible_profile_id, created_by, created_at, updated_at";

const querySchema = z.object({
  responsible_profile_id: z.string().uuid(),
});

/** `YYYY-MM-DD` no fuso informado — o "dia" que vira à meia-noite LOCAL, não em UTC. */
function hojeNoFuso(timezone: string): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const pega = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${pega("year")}-${pega("month")}-${pega("day")}`;
}

function ordenarPorImportancia(tarefas: Tarefa[]): Tarefa[] {
  return [...tarefas].sort((a, b) => {
    const ra = RANK_DA_PRIORIDADE[a.priority] ?? 9;
    const rb = RANK_DA_PRIORIDADE[b.priority] ?? 9;
    if (ra !== rb) return ra - rb;
    const da = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
    const db = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
    return da - db;
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("agent", { requestId, resource: "crm_tasks" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { org } = authz;

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) {
    return fail("validation_failed", t("Escolha um responsável para ver a fila do dia."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const { responsible_profile_id } = parsed.data;

  if (!(await responsavelDaTarefaExiste(org.orgId, responsible_profile_id))) {
    return fail("not_found", t("Responsável não encontrado."), 404, { requestId });
  }

  const supabase = await createClient();

  const { data: organizacao } = await supabase
    .from("organizations")
    .select("timezone")
    .eq("id", org.orgId)
    .maybeSingle();
  const hoje = hojeNoFuso((organizacao?.timezone as string | undefined) ?? "America/Sao_Paulo");

  const { data: existente, error: erroExistente } = await supabase
    .from("crm_task_daily_queue")
    .select("task_id")
    .eq("organization_id", org.orgId)
    .eq("responsible_profile_id", responsible_profile_id)
    .eq("queue_date", hoje)
    .order("position", { ascending: true });
  if (erroExistente) {
    return fail("internal_error", t("Erro ao consultar a fila do dia."), 500, { requestId });
  }

  let idsOrdenados = (existente ?? []).map((linha) => linha.task_id as string);
  let materializada = false;

  if (idsOrdenados.length === 0) {
    const { data: abertas, error: erroAbertas } = await supabase
      .from("crm_tasks")
      .select(COLUNAS_TAREFA)
      .eq("organization_id", org.orgId)
      .eq("responsible_profile_id", responsible_profile_id)
      .in("status", ["pending", "in_progress"]);
    if (erroAbertas) {
      return fail("internal_error", t("Erro ao montar a fila do dia."), 500, { requestId });
    }

    const selecionadas = ordenarPorImportancia((abertas ?? []) as unknown as Tarefa[]).slice(
      0,
      TETO_DA_FILA,
    );
    idsOrdenados = selecionadas.map((tarefa) => tarefa.id);

    if (idsOrdenados.length > 0) {
      const linhas = idsOrdenados.map((taskId, indice) => ({
        organization_id: org.orgId,
        responsible_profile_id,
        queue_date: hoje,
        task_id: taskId,
        position: indice + 1,
      }));
      const { error: erroInsert } = await supabase.from("crm_task_daily_queue").insert(linhas);
      if (erroInsert) {
        if (erroInsert.code === "23505") {
          // Duas abas abriram a fila no mesmo instante — a segunda perde a
          // corrida contra a constraint única. Relê o que a primeira gravou
          // em vez de tratar como erro: as duas têm que ver a MESMA fila.
          const { data: releitura } = await supabase
            .from("crm_task_daily_queue")
            .select("task_id")
            .eq("organization_id", org.orgId)
            .eq("responsible_profile_id", responsible_profile_id)
            .eq("queue_date", hoje)
            .order("position", { ascending: true });
          idsOrdenados = (releitura ?? []).map((linha) => linha.task_id as string);
        } else {
          return fail("internal_error", t("Erro ao salvar a fila do dia."), 500, { requestId });
        }
      } else {
        materializada = true;
      }
    }
  }

  const { data: tarefasVivas, error: erroTarefas } = await supabase
    .from("crm_tasks")
    .select(COLUNAS_TAREFA)
    .eq("organization_id", org.orgId)
    .in("id", idsOrdenados.length > 0 ? idsOrdenados : ["00000000-0000-0000-0000-000000000000"]);
  if (erroTarefas) {
    return fail("internal_error", t("Erro ao carregar as tarefas da fila."), 500, { requestId });
  }

  const porId = new Map((tarefasVivas ?? []).map((tarefa) => [tarefa.id as string, tarefa as unknown as Tarefa]));
  const tarefasNaOrdem = idsOrdenados.map((id) => porId.get(id)).filter((t): t is Tarefa => Boolean(t));

  if (materializada) {
    void audit({
      action: "crm_task_daily_queue.created",
      actorUserId: authz.user.id,
      organizationId: org.orgId,
      resourceType: "crm_task_daily_queue",
      resourceId: responsible_profile_id,
      requestId,
      metadata: { queue_date: hoje, total: idsOrdenados.length },
    });
  }

  return ok(
    { queue_date: hoje, responsible_profile_id, total: tarefasNaOrdem.length, tasks: tarefasNaOrdem },
    { requestId },
  );
}
