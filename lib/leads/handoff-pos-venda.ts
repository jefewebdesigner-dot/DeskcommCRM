import type { SupabaseClient } from "@supabase/supabase-js";

import type { HandlerCtx } from "@/lib/api/handlers/types";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { tipoOperacionalDoFunil } from "@/lib/pipelines/funis-operacionais";

export interface ResultadoHandoffPosVenda {
  ok: boolean;
  criado: boolean;
  leadId: string | null;
  motivo?: string;
}

function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

/**
 * Venda ganha não "muda" para pós-venda: ela permanece encerrada no histórico
 * comercial e nasce um NOVO card operacional no funil de Pós-vendas. Assim o
 * mesmo cliente pode continuar ativo e, ao mesmo tempo, abrir Suporte ou entrar
 * em Retenção sem destruir a história de Vendas.
 *
 * Idempotência: `source + external_id` usa o índice único já existente em
 * `crm_leads`; reexecutar a transição não duplica cliente nem onboarding.
 */
export async function garantirPosVendaDaVendaGanha(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  venda: Record<string, unknown>,
): Promise<ResultadoHandoffPosVenda> {
  const vendaId = typeof venda.id === "string" ? venda.id : null;
  const pipelineOrigemId = typeof venda.pipeline_id === "string" ? venda.pipeline_id : null;
  const contactId = typeof venda.contact_id === "string" ? venda.contact_id : null;
  if (!vendaId || !pipelineOrigemId || !contactId) {
    return { ok: true, criado: false, leadId: null, motivo: "venda_sem_vinculo" };
  }

  const { data: origem, error: origemError } = await supabase
    .from("crm_pipelines")
    .select("id, settings")
    .eq("organization_id", ctx.organization_id)
    .eq("id", pipelineOrigemId)
    .maybeSingle();
  if (origemError) return { ok: false, criado: false, leadId: null, motivo: origemError.message };
  if (!origem || tipoOperacionalDoFunil(objeto(origem.settings)) !== "sales") {
    return { ok: true, criado: false, leadId: null, motivo: "origem_nao_e_vendas" };
  }

  const { data: funis, error: funisError } = await supabase
    .from("crm_pipelines")
    .select("id, settings")
    .eq("organization_id", ctx.organization_id)
    .eq("is_archived", false)
    .order("position", { ascending: true });
  if (funisError) return { ok: false, criado: false, leadId: null, motivo: funisError.message };

  const posVenda = (funis ?? []).find(
    (f) => tipoOperacionalDoFunil(objeto(f.settings)) === "post_sales",
  );
  if (!posVenda) {
    return { ok: false, criado: false, leadId: null, motivo: "funil_pos_venda_ausente" };
  }

  const externalId = `sales_won:${vendaId}`;
  const { data: existente, error: existenteError } = await supabase
    .from("crm_leads")
    .select("id")
    .eq("organization_id", ctx.organization_id)
    .eq("source", "lifecycle_handoff")
    .eq("external_id", externalId)
    .maybeSingle();
  if (existenteError) {
    return { ok: false, criado: false, leadId: null, motivo: existenteError.message };
  }

  let posVendaLeadId = existente?.id ?? null;
  let criado = false;

  if (!posVendaLeadId) {
    const { data: etapa, error: etapaError } = await supabase
      .from("crm_stages")
      .select("id")
      .eq("organization_id", ctx.organization_id)
      .eq("pipeline_id", posVenda.id)
      .eq("is_archived", false)
      .eq("is_won", false)
      .eq("is_lost", false)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (etapaError || !etapa) {
      return {
        ok: false,
        criado: false,
        leadId: null,
        motivo: etapaError?.message ?? "funil_pos_venda_sem_etapa_inicial",
      };
    }

    const { data: ultimo, error: ultimoError } = await supabase
      .from("crm_leads")
      .select("position_in_stage")
      .eq("organization_id", ctx.organization_id)
      .eq("stage_id", etapa.id)
      .order("position_in_stage", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ultimoError) return { ok: false, criado: false, leadId: null, motivo: ultimoError.message };

    const ownerKind = venda.owner_kind === "user" || venda.owner_kind === "ai" ? venda.owner_kind : null;
    const ownerUserId = ownerKind === "user" && typeof venda.owner_user_id === "string" ? venda.owner_user_id : null;
    const ownerAgentId = ownerKind === "ai" && typeof venda.owner_agent_id === "string" ? venda.owner_agent_id : null;
    const sourceMetadata = {
      ...objeto(venda.source_metadata),
      lifecycle_handoff: {
        kind: "sales_to_post_sales",
        source_lead_id: vendaId,
        source_pipeline_id: pipelineOrigemId,
      },
    };

    const { data: criadoLead, error: criarError } = await supabase
      .from("crm_leads")
      .insert({
        organization_id: ctx.organization_id,
        pipeline_id: posVenda.id,
        stage_id: etapa.id,
        contact_id: contactId,
        title: typeof venda.title === "string" ? venda.title : "Cliente em onboarding",
        description: typeof venda.description === "string" ? venda.description : null,
        value_cents: typeof venda.value_cents === "number" ? venda.value_cents : null,
        currency: typeof venda.currency === "string" ? venda.currency : "BRL",
        owner_kind: ownerKind,
        owner_user_id: ownerUserId,
        owner_agent_id: ownerAgentId,
        assigned_at: ownerKind ? new Date().toISOString() : null,
        tags: Array.isArray(venda.tags) ? venda.tags : [],
        source: "lifecycle_handoff",
        external_id: externalId,
        source_metadata: sourceMetadata,
        custom_fields: objeto(venda.custom_fields),
        status: "open",
        position_in_stage:
          ultimo?.position_in_stage == null ? 1000 : Number(ultimo.position_in_stage) + 1000,
        created_by_user_id: ctx.actor.type === "user" ? ctx.actor.id : null,
      })
      .select("id")
      .single();

    if (criarError || !criadoLead) {
      if (criarError?.code === "23505") {
        const { data: concorrente } = await supabase
          .from("crm_leads")
          .select("id")
          .eq("organization_id", ctx.organization_id)
          .eq("source", "lifecycle_handoff")
          .eq("external_id", externalId)
          .maybeSingle();
        posVendaLeadId = concorrente?.id ?? null;
      } else {
        return {
          ok: false,
          criado: false,
          leadId: null,
          motivo: criarError?.message ?? "falha_ao_criar_pos_venda",
        };
      }
    } else {
      posVendaLeadId = criadoLead.id;
      criado = true;
    }
  }

  if (!posVendaLeadId) {
    return { ok: false, criado: false, leadId: null, motivo: "handoff_sem_lead_destino" };
  }

  const { data: tarefaExistente, error: tarefaError } = await supabase
    .from("crm_tasks")
    .select("id")
    .eq("organization_id", ctx.organization_id)
    .eq("lead_id", posVendaLeadId)
    .eq("title", "Validar onboarding")
    .in("status", ["pending", "in_progress"])
    .limit(1)
    .maybeSingle();
  if (tarefaError) return { ok: false, criado, leadId: posVendaLeadId, motivo: tarefaError.message };

  if (!tarefaExistente) {
    const prazo = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const assignedTo =
      venda.owner_kind === "user" && typeof venda.owner_user_id === "string"
        ? venda.owner_user_id
        : null;
    const { data: tarefa, error: criarTarefaError } = await supabase
      .from("crm_tasks")
      .insert({
        organization_id: ctx.organization_id,
        title: "Validar onboarding",
        description: "Criada automaticamente após a venda ser marcada como ganha.",
        due_date: prazo,
        priority: "high",
        status: "pending",
        lead_id: posVendaLeadId,
        contact_id: contactId,
        assigned_to: assignedTo,
        created_by: ctx.actor.type === "user" ? ctx.actor.id : null,
      })
      .select("id")
      .single();
    if (criarTarefaError) {
      return { ok: false, criado, leadId: posVendaLeadId, motivo: criarTarefaError.message };
    }

    if (tarefa) {
      await emitLeadActivity(supabase, {
        organizationId: ctx.organization_id,
        leadId: posVendaLeadId,
        contactId,
        type: "task_created",
        sourceModule: "crm",
        sourceId: tarefa.id,
        actor: ctx.actor,
        reason: "Validar onboarding",
        payload: { automatic: true, source: "sales_won", due_date: prazo },
      });
    }
  }

  return { ok: true, criado, leadId: posVendaLeadId };
}
