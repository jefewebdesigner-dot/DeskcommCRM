import { updateLeadHandler } from "@/app/api/v1/leads/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveActiveLeadForContact,
  type LeadCandidate,
} from "@/lib/leads/active-lead";
import {
  camposDeclaradosDoFunil,
  decidirAutoPreenchimento,
  type CamposDaConversa,
} from "@/lib/leads/agent-field-policy";

interface LeadRow extends LeadCandidate {
  custom_fields: Record<string, unknown> | null;
}

/**
 * Espelha fatos EXTRAÍDOS da conversa para o negócio visível do CRM.
 *
 * Não decide fatos e não chama modelo. Recebe apenas valores que o mesmo turno
 * do Conversador já marcou explicitamente via update_lead_state.crm_fields.
 */
export async function espelharCamposDaConversaNoCrm(input: {
  organizationId: string;
  contactId: string;
  agentId: string;
  pipelineIds: string[];
  requestId: string;
  fields: CamposDaConversa;
}): Promise<{
  ok: boolean;
  leadId?: string;
  atualizados: string[];
  protegidos: string[];
  ignorados: string[];
  motivo?: string;
}> {
  if (Object.keys(input.fields).length === 0) {
    return { ok: true, atualizados: [], protegidos: [], ignorados: [] };
  }
  if (input.pipelineIds.length === 0) {
    return {
      ok: true,
      atualizados: [],
      protegidos: [],
      ignorados: Object.keys(input.fields),
      motivo: "agente_sem_funil_liberado",
    };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("crm_leads")
    .select(
      "id,organization_id,pipeline_id,status,last_activity_at,created_at,custom_fields",
    )
    .eq("organization_id", input.organizationId)
    .eq("contact_id", input.contactId)
    .eq("status", "open")
    .in("pipeline_id", input.pipelineIds);

  if (error) {
    return {
      ok: false,
      atualizados: [],
      protegidos: [],
      ignorados: [],
      motivo: error.message,
    };
  }

  const rows = (data ?? []) as unknown as LeadRow[];
  const target = resolveActiveLeadForContact(rows);
  if (!target.routed) {
    return {
      ok: true,
      atualizados: [],
      protegidos: [],
      ignorados: Object.keys(input.fields),
      motivo: target.reason,
    };
  }

  const lead = rows.find((row) => row.id === target.leadId);
  if (!lead) {
    return {
      ok: false,
      atualizados: [],
      protegidos: [],
      ignorados: [],
      motivo: "lead_resolvido_nao_encontrado",
    };
  }

  const { data: pipeline, error: pipelineError } = await admin
    .from("crm_pipelines")
    .select("settings")
    .eq("organization_id", input.organizationId)
    .eq("id", lead.pipeline_id)
    .maybeSingle();

  if (pipelineError || !pipeline) {
    return {
      ok: false,
      leadId: lead.id,
      atualizados: [],
      protegidos: [],
      ignorados: [],
      motivo: pipelineError?.message ?? "pipeline_nao_encontrado",
    };
  }

  const current =
    lead.custom_fields && typeof lead.custom_fields === "object"
      ? lead.custom_fields
      : {};
  const decision = decidirAutoPreenchimento({
    fields: camposDeclaradosDoFunil(
      (pipeline as { settings?: unknown }).settings,
    ),
    current,
    proposed: input.fields,
    agentId: input.agentId,
    nowIso: new Date().toISOString(),
  });

  if (decision.atualizados.length === 0) {
    return { ok: true, leadId: lead.id, ...decision };
  }

  const ctx: HandlerCtx = {
    organization_id: input.organizationId,
    actor: {
      type: "ai_agent",
      id: input.requestId,
      role: "agent",
      agent_id: input.agentId,
    },
    requestId: input.requestId,
  };

  try {
    await updateLeadHandler(admin, ctx, lead.id, {
      custom_fields: decision.patch,
    });
    return { ok: true, leadId: lead.id, ...decision };
  } catch (error) {
    return {
      ok: false,
      leadId: lead.id,
      atualizados: [],
      protegidos: decision.protegidos,
      ignorados: decision.ignorados,
      motivo: error instanceof Error ? error.message : String(error),
    };
  }
}
