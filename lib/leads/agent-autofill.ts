import type pg from "pg";

import { createAdminClient } from "@/lib/supabase/admin";
import { emitAgentActivityForContact } from "@/lib/leads/agent-activity";
import { resolveActiveLeadForContact, type LeadCandidate } from "@/lib/leads/active-lead";

type CampoDoFunil = {
  key: string;
  label: string;
  type: string;
};

type LinhaDoNegocio = {
  id: string;
  pipeline_id: string;
  custom_fields: Record<string, unknown> | null;
  updated_at: string;
  settings: Record<string, unknown> | null;
};

function objeto(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function vazio(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function camposDeclarados(settings: unknown): CampoDoFunil[] {
  const fields = objeto(settings).fields;
  if (!Array.isArray(fields)) return [];

  return fields.flatMap((raw) => {
    const row = objeto(raw);
    const key = typeof row.key === "string" ? row.key.trim() : "";
    const label = typeof row.label === "string" ? row.label.trim() : key;
    const type = typeof row.type === "string" ? row.type.trim() : "text";
    if (!key || !/^[a-zA-Z0-9_-]{1,80}$/.test(key)) return [];
    return [{ key, label: label || key, type }];
  });
}

function normalizarValor(type: string, value: unknown): string | number | boolean | undefined {
  if (typeof value === "string") {
    const texto = value.trim();
    if (!texto || texto.length > 2000) return undefined;
    if (type === "number") {
      const numero = Number(texto.replace(",", "."));
      return Number.isFinite(numero) ? numero : undefined;
    }
    if (type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return undefined;
    return texto;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "boolean") return value;
  return undefined;
}

async function negocioAtivo(
  pool: pg.Pool,
  organizationId: string,
  contactId: string,
): Promise<{ routed: true; leadId: string } | { routed: false; reason: string }> {
  const [candidatos, padrao] = await Promise.all([
    pool.query<LeadCandidate>(
      `select id, organization_id, pipeline_id, status, last_activity_at, created_at
         from crm_leads
        where organization_id = $1 and contact_id = $2`,
      [organizationId, contactId],
    ),
    pool.query<{ id: string }>(
      `select id from crm_pipelines
        where organization_id = $1 and is_default = true and is_archived = false
        limit 1`,
      [organizationId],
    ),
  ]);

  const alvo = resolveActiveLeadForContact(candidatos.rows, {
    defaultPipelineId: padrao.rows[0]?.id ?? null,
  });
  if (!alvo.routed) return { routed: false, reason: alvo.reason };
  return { routed: true, leadId: alvo.leadId };
}

async function linhaDoNegocio(
  pool: pg.Pool,
  organizationId: string,
  leadId: string,
): Promise<LinhaDoNegocio | null> {
  const { rows } = await pool.query<LinhaDoNegocio>(
    `select l.id, l.pipeline_id, l.custom_fields, l.updated_at::text as updated_at,
            p.settings
       from crm_leads l
       join crm_pipelines p
         on p.id = l.pipeline_id and p.organization_id = l.organization_id
      where l.organization_id = $1 and l.id = $2 and l.status = 'open'
      limit 1`,
    [organizationId, leadId],
  );
  return rows[0] ?? null;
}

/**
 * Bloco curto e dinâmico para o fechamento do turno.
 *
 * Só expõe campos DECLARADOS pelo funil e ainda VAZIOS no card. O modelo não
 * recebe a possibilidade de reescrever um dado que uma pessoa já preencheu.
 */
export async function blocoDeAutopreenchimentoDoCrm(
  pool: pg.Pool,
  organizationId: string,
  contactId: string,
): Promise<string> {
  const alvo = await negocioAtivo(pool, organizationId, contactId);
  if (!alvo.routed) return "";

  const lead = await linhaDoNegocio(pool, organizationId, alvo.leadId);
  if (!lead) return "";

  const atuais = objeto(lead.custom_fields);
  const disponiveis = camposDeclarados(lead.settings)
    .filter((field) => vazio(atuais[field.key]))
    .slice(0, 30);

  if (disponiveis.length === 0) return "";

  return [
    "## Campos do CRM disponíveis para autopreenchimento",
    "No JSON de fechamento, use `crm_fields` SOMENTE para fatos explícitos que o cliente revelou na conversa.",
    "Nunca deduza, complete por contexto ou repita campo que não esteja na lista abaixo. Se não houver fato novo, use {}.",
    JSON.stringify(disponiveis),
  ].join("\n");
}

export type ResultadoDoAutopreenchimento =
  | { updated: true; leadId: string; keys: string[] }
  | { updated: false; reason: "sem_negocio" | "sem_campos_validos" | "conflito_humano" };

/**
 * Espelha os fatos extraídos no card do CRM.
 *
 * Guarda principal: só escreve campo que ainda está vazio. A escrita também usa
 * trava otimista por updated_at; se uma pessoa editar o card entre a leitura e o
 * UPDATE, zero linhas são tocadas e a decisão humana vence.
 */
export async function aplicarAutopreenchimentoDoCrm(
  pool: pg.Pool,
  input: {
    organizationId: string;
    contactId: string;
    fields: Record<string, unknown>;
    agentId?: string | null;
  },
): Promise<ResultadoDoAutopreenchimento> {
  if (Object.keys(input.fields).length === 0) {
    return { updated: false, reason: "sem_campos_validos" };
  }

  const alvo = await negocioAtivo(pool, input.organizationId, input.contactId);
  if (!alvo.routed) return { updated: false, reason: "sem_negocio" };

  const lead = await linhaDoNegocio(pool, input.organizationId, alvo.leadId);
  if (!lead) return { updated: false, reason: "sem_negocio" };

  const atuais = objeto(lead.custom_fields);
  const declarados = new Map(camposDeclarados(lead.settings).map((f) => [f.key, f]));
  const patch: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(input.fields)) {
    const field = declarados.get(key);
    if (!field || !vazio(atuais[key])) continue;
    const normalizado = normalizarValor(field.type, value);
    if (normalizado !== undefined) patch[key] = normalizado;
  }

  const keys = Object.keys(patch);
  if (keys.length === 0) return { updated: false, reason: "sem_campos_validos" };

  const updated = await pool.query<{ id: string }>(
    `update crm_leads
        set custom_fields = coalesce(custom_fields, '{}'::jsonb) || $3::jsonb,
            updated_at = now()
      where organization_id = $1
        and id = $2
        and updated_at = $4::timestamptz
      returning id`,
    [input.organizationId, lead.id, JSON.stringify(patch), lead.updated_at],
  );

  if (updated.rows.length === 0) {
    return { updated: false, reason: "conflito_humano" };
  }

  await emitAgentActivityForContact({
    pool,
    organizationId: input.organizationId,
    contactId: input.contactId,
    type: "lead_edited",
    sourceModule: "agent",
    sourceId: lead.id,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    reason: "Preencheu automaticamente campos do negócio a partir da conversa",
    payload: {
      fields: ["custom_fields"],
      custom_field_keys: keys,
      automatic: true,
    },
  });

  const admin = createAdminClient();
  const { error } = await admin.rpc("emit_event", {
    p_event_type: "lead.updated",
    p_entity_kind: "crm_lead",
    p_entity_id: lead.id,
    p_payload: {
      fields: ["custom_fields"],
      custom_field_keys: keys,
      source: "ai_autofill",
    },
    p_metadata: {
      actor_type: "ai_agent",
      ...(input.agentId ? { actor_id: input.agentId } : { actor_id: "agent-engine" }),
    },
    p_organization_id: input.organizationId,
  });
  if (error) {
    throw new Error(`autopreenchimento gravou o card, mas falhou ao emitir lead.updated: ${error.message}`);
  }

  return { updated: true, leadId: lead.id, keys };
}
