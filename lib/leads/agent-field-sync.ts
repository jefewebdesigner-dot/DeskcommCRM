import { updateLeadHandler } from "@/app/api/v1/leads/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveActiveLeadForContact,
  type LeadCandidate,
} from "@/lib/leads/active-lead";

export type ValorAutoPreenchivel = string | number | boolean;
export type CamposDaConversa = Record<string, ValorAutoPreenchivel>;

export interface CampoDeclaradoDoFunil {
  key: string;
  label: string;
  type: string;
  options?: unknown;
}

interface MarcaDaIa {
  value: ValorAutoPreenchivel;
  updated_at: string;
  agent_id: string;
}

type MapaDaIa = Record<string, MarcaDaIa>;

const CHAVE_DE_PROVENIENCIA = "__ia_autofill";

function objeto(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function camposDeclaradosDoFunil(settings: unknown): CampoDeclaradoDoFunil[] {
  const fields = objeto(settings).fields;
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((raw) => {
    const row = objeto(raw);
    const key = typeof row.key === "string" ? row.key.trim() : "";
    const label = typeof row.label === "string" ? row.label.trim() : key;
    const type = typeof row.type === "string" ? row.type.trim() : "text";
    if (!key || key === CHAVE_DE_PROVENIENCIA) return [];
    return [{ key, label: label || key, type, options: row.options }];
  });
}

function valorVazio(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function mesmoValor(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizar(
  campo: CampoDeclaradoDoFunil,
  value: ValorAutoPreenchivel,
): ValorAutoPreenchivel | null {
  if (campo.type === "number") {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return null;
    const normalized = value.trim().replace(",", ".");
    if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (campo.type === "checkbox" || campo.type === "boolean") {
    return typeof value === "boolean" ? value : null;
  }

  const text = String(value).trim();
  if (!text) return null;
  if (campo.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text.slice(0, 2000);
}

export interface DecisaoDeAutoPreenchimento {
  patch: Record<string, unknown>;
  atualizados: string[];
  protegidos: string[];
  ignorados: string[];
}

/**
 * Regra pura do auto-preenchimento:
 * - só chaves declaradas pelo funil;
 * - nunca apaga campo;
 * - campo vazio pode ser preenchido;
 * - campo já escrito pela IA pode evoluir quando surge evidência nova;
 * - campo alterado por humano depois da IA fica protegido.
 */
export function decidirAutoPreenchimento(input: {
  fields: CampoDeclaradoDoFunil[];
  current: Record<string, unknown>;
  proposed: CamposDaConversa;
  agentId: string;
  nowIso: string;
}): DecisaoDeAutoPreenchimento {
  const allowed = new Map(input.fields.map((field) => [field.key, field]));
  const oldMeta = objeto(input.current[CHAVE_DE_PROVENIENCIA]) as MapaDaIa;
  const nextMeta: MapaDaIa = { ...oldMeta };
  const patch: Record<string, unknown> = {};
  const atualizados: string[] = [];
  const protegidos: string[] = [];
  const ignorados: string[] = [];

  for (const [key, raw] of Object.entries(input.proposed)) {
    const field = allowed.get(key);
    if (!field) {
      ignorados.push(key);
      continue;
    }

    const next = normalizar(field, raw);
    if (next === null) {
      ignorados.push(key);
      continue;
    }

    const current = input.current[key];
    const previousAi = objeto(oldMeta[key]);
    const aiOwned =
      Object.prototype.hasOwnProperty.call(previousAi, "value") &&
      mesmoValor(current, previousAi.value);

    if (!valorVazio(current) && !aiOwned) {
      protegidos.push(key);
      continue;
    }

    if (mesmoValor(current, next)) continue;

    patch[key] = next;
    nextMeta[key] = {
      value: next,
      updated_at: input.nowIso,
      agent_id: input.agentId,
    };
    atualizados.push(key);
  }

  if (atualizados.length > 0) patch[CHAVE_DE_PROVENIENCIA] = nextMeta;
  return { patch, atualizados, protegidos, ignorados };
}

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

  const decision = decidirAutoPreenchimento({
    fields: camposDeclaradosDoFunil(
      (pipeline as { settings?: unknown }).settings,
    ),
    current: objeto(lead.custom_fields),
    proposed: input.fields,
    agentId: input.agentId,
    nowIso: new Date().toISOString(),
  });

  if (decision.atualizados.length === 0) {
    return { ok: true, leadId: lead.id, ...decision };
  }

  const ctx: HandlerCtx = {
    organization_id: input.organizationId,
    actor: { type: "ai_agent", id: input.agentId },
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
