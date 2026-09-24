import { createHash } from "node:crypto";

import { publishFirstVersion } from "@/lib/ai/agents/first-publication";
import { publishAgentVersion } from "@/lib/ai/agents/publish";
import { publicarMemoriaDaOrg } from "@/lib/ai/memoria-da-org";
import { aplicarAutomacoesDoBlueprint } from "@/lib/tenants/apply-blueprint-automations";
import { audit } from "@/lib/audit";
import { slugify } from "@/lib/auth/provision";
import type { Json } from "@/lib/database.types";
import type { SalesTwinBlueprint } from "@/lib/schemas/tenant-blueprint";
import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

type Warning = { code: string; message: string };

export type AppliedBlueprintResult = {
  organization_id: string;
  deployment_id: string;
  blueprint_hash: string;
  replay: boolean;
  pipeline: {
    id: string;
    stages: Array<{ id: string; name: string; is_won: boolean; is_lost: boolean }>;
    fields_count: number;
  };
  agent: {
    id: string;
    published: boolean;
    publish_blocked_by: string | null;
    version_id: string | null;
  };
  knowledge: {
    memory_version_id: string | null;
    required_sources: string[];
    missing_facts: string[];
  };
  automations: {
    planned: number;
    prepared: number;
    materialized: number;
    pending: number;
    state: "none" | "active" | "prepared_waiting_channel" | "partial";
    pointer_ids: string[];
  };
  warnings: Warning[];
};

function normalizarTexto(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (!v || typeof v !== "object") return v;
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, value]) => [k, canonical(value)]),
  );
}

export function hashBlueprint(blueprint: SalesTwinBlueprint): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(blueprint)))
    .digest("hex");
}

export function erroDeColunaDeAuditoriaDeEtapaAusente(error: unknown): boolean {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  return /Could not find the 'last_change_(actor_kind|at)' column of 'crm_stages' in the schema cache/i.test(
    message,
  );
}

function registrarAvisoDeCompatibilidadeDeEtapa(warnings: Warning[]): void {
  if (warnings.some((w) => w.code === "crm_stages_legacy_without_audit_columns")) return;
  warnings.push({
    code: "crm_stages_legacy_without_audit_columns",
    message:
      "O banco desta instalação ainda não tem as colunas de auditoria de etapas; o Blueprint foi aplicado em modo compatível.",
  });
}

function uniqueSlug(name: string, used: Set<string>): string {
  const raw = slugify(name).slice(0, 40) || "etapa";
  let out = raw;
  let n = 2;
  while (used.has(out)) {
    const suffix = "-" + n++;
    out = raw.slice(0, Math.max(1, 40 - suffix.length)) + suffix;
  }
  used.add(out);
  return out;
}

export function stageSemantics(stages: string[]): {
  wonIndex: number | null;
  lostIndex: number | null;
} {
  const normalized = stages.map(normalizarTexto);
  let wonIndex: number | null = null;
  let lostIndex: number | null = null;

  normalized.forEach((s, i) => {
    if (
      /(^| )(fechado|fechada|ganho|ganha|vendido|vendida|venda concluida|contrato assinado|cliente)( |$)/.test(
        s,
      )
    ) {
      wonIndex = i;
    }
    if (/(^| )(perdido|perdida|cancelado|cancelada|desistiu|desistencia|nao fechou)( |$)/.test(s)) {
      lostIndex = i;
    }
  });

  return { wonIndex, lostIndex };
}

function promptDoAgente(blueprint: SalesTwinBlueprint): string {
  const b = blueprint;
  const lines = [
    `Você é ${b.agent.name}, agente comercial de ${b.organization.name}.`,
    b.organization.segment ? `Segmento: ${b.organization.segment}.` : "",
    b.organization.location ? `Localidade: ${b.organization.location}.` : "",
    b.agent.objective ? `Objetivo: ${b.agent.objective}` : "",
    b.agent.tone ? `Tom de atendimento: ${b.agent.tone}` : "",
    b.offer.primary ? `Oferta principal: ${b.offer.primary}` : "",
    b.offer.services.length ? `Serviços/produtos conhecidos: ${b.offer.services.join(", ")}.` : "",
    b.agent.qualification_questions.length
      ? "Qualifique sem interrogatório, usando quando necessário estas perguntas:\n- " +
        b.agent.qualification_questions.join("\n- ")
      : "",
    b.agent.handoff_rules.length
      ? "Passe para uma pessoa do time quando ocorrer:\n- " + b.agent.handoff_rules.join("\n- ")
      : "",
    b.agent.forbidden_claims.length
      ? "Nunca faça estas afirmações/ações:\n- " + b.agent.forbidden_claims.join("\n- ")
      : "",
    "Nunca invente preço, prazo, disponibilidade, resultado, depoimento, certificação ou fato que não esteja nas informações confirmadas da empresa.",
    "Quando faltar informação factual, diga que precisa confirmar com a equipe em vez de preencher a lacuna por conta própria.",
    "Seu papel é avançar a conversa para o próximo passo comercial adequado e registrar o contexto no CRM.",
  ].filter(Boolean);

  return lines.join("\n\n").slice(0, 19000);
}

function memoriaDaEmpresa(blueprint: SalesTwinBlueprint): string {
  const b = blueprint;
  const parts = [
    `# ${b.organization.name}`,
    b.organization.summary ? `## Sobre o negócio\n${b.organization.summary}` : "",
    b.offer.primary ? `## Oferta principal\n${b.offer.primary}` : "",
    b.offer.services.length
      ? `## Serviços/produtos confirmados\n- ${b.offer.services.join("\n- ")}`
      : "",
    b.knowledge.known_facts.length
      ? `## Fatos confirmados\n- ${b.knowledge.known_facts.join("\n- ")}`
      : "",
    b.agent.forbidden_claims.length
      ? `## Limites obrigatórios\n- ${b.agent.forbidden_claims.join("\n- ")}`
      : "",
  ].filter(Boolean);
  return parts.join("\n\n").slice(0, 30000);
}

async function donoDaOrganizacao(
  admin: Admin,
  organizationId: string,
): Promise<{
  ownerId: string;
  settings: Record<string, unknown>;
  displayName: string;
}> {
  const { data: org, error } = await admin
    .from("organizations")
    .select("id, created_by, settings, display_name")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw new Error("blueprint: organization read failed: " + error.message);
  if (!org) throw new Error("blueprint: organization_not_found");

  let ownerId = org.created_by as string | null;
  if (!ownerId) {
    const { data: member, error: memberErr } = await admin
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("role", "admin")
      .is("revoked_at", null)
      .limit(1)
      .maybeSingle();
    if (memberErr) throw new Error("blueprint: admin lookup failed: " + memberErr.message);
    ownerId = (member?.user_id as string | undefined) ?? null;
  }
  if (!ownerId) throw new Error("blueprint: organization_without_admin");

  return {
    ownerId,
    settings: (org.settings as Record<string, unknown> | null) ?? {},
    displayName: org.display_name,
  };
}

async function aplicarPipeline(
  admin: Admin,
  organizationId: string,
  blueprint: SalesTwinBlueprint,
  deploymentId: string,
  warnings: Warning[],
): Promise<{
  id: string;
  stages: Array<{ id: string; name: string; is_won: boolean; is_lost: boolean }>;
}> {
  // A variável recebe a linha criada caso a org não tenha funil padrão.
  // eslint-disable-next-line prefer-const
  let { data: pipeline, error: pipeErr } = await admin
    .from("crm_pipelines")
    .select("id,name,slug,settings,vocabulary,is_archived,is_default")
    .eq("organization_id", organizationId)
    .eq("is_default", true)
    .limit(1)
    .maybeSingle();

  if (pipeErr) throw new Error("blueprint: pipeline read failed: " + pipeErr.message);

  if (!pipeline) {
    const { data: created, error } = await admin
      .from("crm_pipelines")
      .insert({
        organization_id: organizationId,
        name: blueprint.pipeline.pipeline_name,
        description: "Funil provisionado pelo Zheus Sales Twin.",
        slug: (
          "sales-twin-" + createHash("sha256").update(deploymentId).digest("hex").slice(0, 12)
        ).slice(0, 40),
        position: 1000,
        is_default: true,
        settings: {},
        vocabulary: {},
      })
      .select("id,name,slug,settings,vocabulary,is_archived,is_default")
      .single();
    if (error || !created)
      throw new Error("blueprint: pipeline create failed: " + (error?.message ?? "no_row"));
    pipeline = created;
  }

  const currentSettings = (pipeline.settings as Record<string, unknown> | null) ?? {};
  const currentVocabulary = (pipeline.vocabulary as Record<string, unknown> | null) ?? {};
  const fields = blueprint.pipeline.lead_fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required,
    ...(f.options ? { options: f.options } : {}),
  }));

  const { error: updatePipeErr } = await admin
    .from("crm_pipelines")
    .update({
      name: blueprint.pipeline.pipeline_name,
      description: "Funil provisionado pelo Zheus Sales Twin.",
      is_archived: false,
      settings: {
        ...currentSettings,
        fields,
        canonical_tags: blueprint.pipeline.tags,
        sales_twin: {
          deployment_id: deploymentId,
          managed: true,
          updated_at: new Date().toISOString(),
        },
      } as Json,
      vocabulary: {
        ...currentVocabulary,
        ...(blueprint.pipeline.vocabulary ?? {}),
      } as Json,
    })
    .eq("organization_id", organizationId)
    .eq("id", pipeline.id);
  if (updatePipeErr) throw new Error("blueprint: pipeline update failed: " + updatePipeErr.message);

  const { data: currentStages, error: stagesErr } = await admin
    .from("crm_stages")
    .select("id,name,slug,position,is_won,is_lost,is_archived")
    .eq("organization_id", organizationId)
    .eq("pipeline_id", pipeline.id)
    .order("position", { ascending: true });
  if (stagesErr) throw new Error("blueprint: stages read failed: " + stagesErr.message);

  const stages = currentStages ?? [];
  const { count: leadCount, error: leadErr } = await admin
    .from("crm_leads")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("pipeline_id", pipeline.id);
  if (leadErr) throw new Error("blueprint: lead count failed: " + leadErr.message);

  if (stages.length) {
    const { error: clearErr } = await admin
      .from("crm_stages")
      .update({ is_won: false, is_lost: false })
      .eq("organization_id", organizationId)
      .eq("pipeline_id", pipeline.id);
    if (clearErr) throw new Error("blueprint: stage flags reset failed: " + clearErr.message);
  }

  const semantic = stageSemantics(blueprint.pipeline.stages);
  if (semantic.wonIndex === null) {
    warnings.push({
      code: "pipeline_without_won_stage",
      message:
        "O Blueprint não nomeou uma etapa claramente vencedora; nenhuma etapa foi marcada como ganha.",
    });
  }

  const usedSlugs = new Set(stages.map((s) => s.slug));
  const resultStages: Array<{ id: string; name: string; is_won: boolean; is_lost: boolean }> = [];
  let auditoriaDeEtapaDisponivel = true;

  for (let i = 0; i < blueprint.pipeline.stages.length; i++) {
    const name = blueprint.pipeline.stages[i]!;
    const isWon = semantic.wonIndex === i;
    const isLost = semantic.lostIndex === i;
    const existing = stages[i];
    const audit = auditoriaDeEtapaDisponivel
      ? { last_change_actor_kind: "sales_twin", last_change_at: new Date().toISOString() }
      : {};

    if (existing) {
      const basePayload = {
        name,
        position: (i + 1) * 1000,
        is_archived: false,
        is_won: isWon,
        is_lost: isLost,
      };
      let result = await admin
        .from("crm_stages")
        .update({ ...basePayload, ...audit })
        .eq("organization_id", organizationId)
        .eq("pipeline_id", pipeline.id)
        .eq("id", existing.id)
        .select("id,name,is_won,is_lost")
        .single();
      if (result.error && auditoriaDeEtapaDisponivel && erroDeColunaDeAuditoriaDeEtapaAusente(result.error)) {
        auditoriaDeEtapaDisponivel = false;
        registrarAvisoDeCompatibilidadeDeEtapa(warnings);
        result = await admin
          .from("crm_stages")
          .update(basePayload)
          .eq("organization_id", organizationId)
          .eq("pipeline_id", pipeline.id)
          .eq("id", existing.id)
          .select("id,name,is_won,is_lost")
          .single();
      }
      if (result.error || !result.data)
        throw new Error("blueprint: stage update failed: " + (result.error?.message ?? "no_row"));
      resultStages.push(result.data);
    } else {
      const basePayload = {
        organization_id: organizationId,
        pipeline_id: pipeline.id,
        name,
        slug: uniqueSlug(name, usedSlugs),
        position: (i + 1) * 1000,
        is_won: isWon,
        is_lost: isLost,
      };
      let result = await admin
        .from("crm_stages")
        .insert({ ...basePayload, ...audit })
        .select("id,name,is_won,is_lost")
        .single();
      if (result.error && auditoriaDeEtapaDisponivel && erroDeColunaDeAuditoriaDeEtapaAusente(result.error)) {
        auditoriaDeEtapaDisponivel = false;
        registrarAvisoDeCompatibilidadeDeEtapa(warnings);
        result = await admin
          .from("crm_stages")
          .insert(basePayload)
          .select("id,name,is_won,is_lost")
          .single();
      }
      if (result.error || !result.data)
        throw new Error("blueprint: stage create failed: " + (result.error?.message ?? "no_row"));
      resultStages.push(result.data);
    }
  }

  const extras = stages.slice(blueprint.pipeline.stages.length);
  if (extras.length) {
    if ((leadCount ?? 0) === 0) {
      const ids = extras.map((s) => s.id);
      const basePayload = { is_archived: true, is_won: false, is_lost: false };
      const audit = auditoriaDeEtapaDisponivel
        ? { last_change_actor_kind: "sales_twin", last_change_at: new Date().toISOString() }
        : {};
      let result = await admin
        .from("crm_stages")
        .update({ ...basePayload, ...audit })
        .in("id", ids)
        .eq("organization_id", organizationId)
        .eq("pipeline_id", pipeline.id);
      if (result.error && auditoriaDeEtapaDisponivel && erroDeColunaDeAuditoriaDeEtapaAusente(result.error)) {
        auditoriaDeEtapaDisponivel = false;
        registrarAvisoDeCompatibilidadeDeEtapa(warnings);
        result = await admin
          .from("crm_stages")
          .update(basePayload)
          .in("id", ids)
          .eq("organization_id", organizationId)
          .eq("pipeline_id", pipeline.id);
      }
      if (result.error) throw new Error("blueprint: extra stages archive failed: " + result.error.message);
    } else {
      warnings.push({
        code: "extra_stages_preserved",
        message:
          "Há negócios no funil; etapas excedentes foram preservadas para não mover/órfãnar dados existentes.",
      });
    }
  }

  return { id: pipeline.id, stages: resultStages };
}

async function aplicarAgente(
  admin: Admin,
  organizationId: string,
  ownerId: string,
  pipelineId: string,
  blueprint: SalesTwinBlueprint,
  blueprintChanged: boolean,
  warnings: Warning[],
): Promise<{
  id: string;
  published: boolean;
  publishBlockedBy: string | null;
  versionId: string | null;
}> {
  const prompt = promptDoAgente(blueprint);

  const { data: current, error: currentErr } = await admin
    .from("ai_agents")
    .select("id,published_version_id,model")
    .eq("organization_id", organizationId)
    .eq("is_default", true)
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();
  if (currentErr) throw new Error("blueprint: agent read failed: " + currentErr.message);

  let agent = current;
  if (agent) {
    const { data, error } = await admin
      .from("ai_agents")
      .update({
        name: blueprint.agent.name,
        description: blueprint.agent.objective,
        system_prompt: prompt,
        kind: "mcp_agent",
        is_active: true,
        archived_at: null,
      })
      .eq("organization_id", organizationId)
      .eq("id", agent.id)
      .select("id,published_version_id,model")
      .single();
    if (error || !data)
      throw new Error("blueprint: agent update failed: " + (error?.message ?? "no_row"));
    agent = data;
  } else {
    const { data, error } = await admin
      .from("ai_agents")
      .insert({
        organization_id: organizationId,
        name: blueprint.agent.name,
        description: blueprint.agent.objective,
        system_prompt: prompt,
        kind: "mcp_agent",
        is_default: true,
        is_active: true,
        created_by: ownerId,
      })
      .select("id,published_version_id,model")
      .single();
    if (error || !data)
      throw new Error("blueprint: agent create failed: " + (error?.message ?? "no_row"));
    agent = data;
  }

  if (!agent.published_version_id) {
    const outcome = await publishFirstVersion(
      admin,
      organizationId,
      { id: agent.id, published_version_id: null },
      prompt,
      ownerId,
    );
    if (!outcome.published) {
      warnings.push({
        code: "agent_not_published_" + outcome.reason,
        message:
          outcome.reason === "no_channel"
            ? "O agente foi configurado, mas fica em rascunho até o WhatsApp ser conectado."
            : "O agente foi configurado, mas ainda não pôde ser publicado: " +
              ("message" in outcome ? outcome.message : outcome.reason),
      });
      return { id: agent.id, published: false, publishBlockedBy: outcome.reason, versionId: null };
    }

    const { data: refreshed } = await admin
      .from("ai_agents")
      .select("published_version_id")
      .eq("organization_id", organizationId)
      .eq("id", agent.id)
      .maybeSingle();
    return {
      id: agent.id,
      published: true,
      publishBlockedBy: null,
      versionId: (refreshed?.published_version_id as string | null) ?? null,
    };
  }

  if (!blueprintChanged) {
    return {
      id: agent.id,
      published: true,
      publishBlockedBy: null,
      versionId: agent.published_version_id,
    };
  }

  const { data: version, error: versionErr } = await admin
    .from("ai_agent_versions")
    .select(
      "provider,model,credential_id,tool_ids,trigger_config,channel_session_id,max_steps,token_budget,cost_budget_cents,history_message_window,history_token_window,handoff_keywords,handoff_tool_enabled,cases_enabled,split_messages,split_max_chars,followup,operator_enabled,operator_model,operator_tool_ids,knowledge_source_ids",
    )
    .eq("organization_id", organizationId)
    .eq("agent_id", agent.id)
    .eq("id", agent.published_version_id)
    .maybeSingle();
  if (versionErr || !version) {
    warnings.push({
      code: "agent_version_read_failed",
      message: versionErr?.message ?? "Versão publicada não encontrada.",
    });
    return {
      id: agent.id,
      published: true,
      publishBlockedBy: "version_read_failed",
      versionId: agent.published_version_id,
    };
  }

  const { data: latest, error: latestErr } = await admin
    .from("ai_agent_versions")
    .select("version_number")
    .eq("organization_id", organizationId)
    .eq("agent_id", agent.id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestErr) throw new Error("blueprint: agent version number failed: " + latestErr.message);

  const { data: draft, error: draftErr } = await admin
    .from("ai_agent_versions")
    .insert({
      organization_id: organizationId,
      agent_id: agent.id,
      version_number: ((latest?.version_number as number | null) ?? 0) + 1,
      provisioning_origin: "sales_twin",
      system_prompt: prompt,
      provider: version.provider,
      model: version.model,
      credential_id: version.credential_id,
      tool_ids: version.tool_ids,
      trigger_config: version.trigger_config,
      channel_session_id: version.channel_session_id,
      max_steps: version.max_steps,
      token_budget: version.token_budget,
      cost_budget_cents: version.cost_budget_cents,
      history_message_window: version.history_message_window,
      history_token_window: version.history_token_window,
      handoff_keywords: version.handoff_keywords,
      handoff_tool_enabled: version.handoff_tool_enabled,
      cases_enabled: version.cases_enabled,
      split_messages: version.split_messages,
      split_max_chars: version.split_max_chars,
      followup: version.followup,
      operator_enabled: version.operator_enabled,
      operator_model: version.operator_model,
      operator_tool_ids: version.operator_tool_ids,
      pipeline_ids: [pipelineId],
      knowledge_source_ids: version.knowledge_source_ids,
      status: "draft",
      created_by: ownerId,
    })
    .select("id")
    .single();

  if (draftErr || !draft) {
    warnings.push({
      code: "agent_version_create_failed",
      message: draftErr?.message ?? "Não foi possível criar nova versão.",
    });
    return {
      id: agent.id,
      published: true,
      publishBlockedBy: "version_create_failed",
      versionId: agent.published_version_id,
    };
  }

  const publish = await publishAgentVersion(admin, {
    orgId: organizationId,
    agentId: agent.id,
    versionId: draft.id,
  });

  if (!publish.ok) {
    warnings.push({ code: "agent_republish_failed", message: publish.message });
    return {
      id: agent.id,
      published: true,
      publishBlockedBy: publish.code,
      versionId: agent.published_version_id,
    };
  }

  return { id: agent.id, published: true, publishBlockedBy: null, versionId: draft.id };
}

export async function applySalesTwinBlueprint(params: {
  organizationId: string;
  integration: string;
  externalId: string;
  blueprint: SalesTwinBlueprint;
  requestId?: string;
}): Promise<AppliedBlueprintResult> {
  const admin = createAdminClient();
  const warnings: Warning[] = [];
  const { ownerId, settings, displayName } = await donoDaOrganizacao(admin, params.organizationId);

  const blueprintHash = hashBlueprint(params.blueprint);
  const currentSalesTwin = (settings.sales_twin as Record<string, unknown> | null) ?? {};
  const previousHash =
    typeof currentSalesTwin.blueprint_hash === "string" ? currentSalesTwin.blueprint_hash : null;
  const replay = previousHash === blueprintHash;

  if (displayName !== params.blueprint.organization.name) {
    const { error } = await admin
      .from("organizations")
      .update({ display_name: params.blueprint.organization.name })
      .eq("id", params.organizationId);
    if (error) throw new Error("blueprint: organization name update failed: " + error.message);
  }

  const pipeline = await aplicarPipeline(
    admin,
    params.organizationId,
    params.blueprint,
    params.blueprint.deployment_id,
    warnings,
  );

  let memoryVersionId: string | null = null;
  if (!replay) {
    const memory = memoriaDaEmpresa(params.blueprint);
    if (memory.trim()) {
      const result = await publicarMemoriaDaOrg(admin, params.organizationId, ownerId, memory);
      if (result.ok) memoryVersionId = result.versionId;
      else warnings.push({ code: "org_memory_not_published", message: result.mensagem });
    }
  }

  const agent = await aplicarAgente(
    admin,
    params.organizationId,
    ownerId,
    pipeline.id,
    params.blueprint,
    !replay,
    warnings,
  );

  const previousManagedIds = Array.isArray(currentSalesTwin.automation_pointer_ids)
    ? currentSalesTwin.automation_pointer_ids.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const automations = await aplicarAutomacoesDoBlueprint({
    admin,
    organizationId: params.organizationId,
    ownerId,
    deploymentId: params.blueprint.deployment_id,
    organizationName: params.blueprint.organization.name,
    automations: params.blueprint.automations,
    stages: pipeline.stages,
    agentId: agent.id,
    replay,
    previousManagedIds,
    warnings,
  });
  if (automations.agentVersionId) {
    agent.versionId = automations.agentVersionId;
  }

  const nextSettings: Record<string, unknown> = {
    ...settings,
    sales_twin: {
      deployment_id: params.blueprint.deployment_id,
      integration: params.integration,
      external_id: params.externalId,
      blueprint_hash: blueprintHash,
      blueprint_version: params.blueprint.sales_twin_version,
      applied_at: new Date().toISOString(),
      pipeline_id: pipeline.id,
      agent_id: agent.id,
      automation_plan: params.blueprint.automations,
      automation_pointer_ids: automations.pointer_ids,
      tracking: params.blueprint.tracking,
      required_sources: params.blueprint.knowledge.required_sources,
      missing_facts: params.blueprint.knowledge.missing_facts,
    },
  };

  const { error: settingsErr } = await admin
    .from("organizations")
    .update({ settings: nextSettings as Json })
    .eq("id", params.organizationId);
  if (settingsErr)
    throw new Error("blueprint: organization settings update failed: " + settingsErr.message);

  await audit({
    action: "tenant.blueprint_applied",
    actorUserId: null,
    organizationId: params.organizationId,
    resourceType: "organization",
    resourceId: params.organizationId,
    requestId: params.requestId,
    bypassedRls: true,
    metadata: {
      integration: params.integration,
      external_id: params.externalId,
      deployment_id: params.blueprint.deployment_id,
      blueprint_hash: blueprintHash,
      replay,
      pipeline_id: pipeline.id,
      agent_id: agent.id,
      agent_published: agent.published,
      automation_plan_count: automations.planned,
      automation_prepared_count: automations.prepared,
      automation_materialized_count: automations.materialized,
      warnings: warnings.map((w) => w.code),
    },
  });

  return {
    organization_id: params.organizationId,
    deployment_id: params.blueprint.deployment_id,
    blueprint_hash: blueprintHash,
    replay,
    pipeline: {
      id: pipeline.id,
      stages: pipeline.stages,
      fields_count: params.blueprint.pipeline.lead_fields.length,
    },
    agent: {
      id: agent.id,
      published: agent.published,
      publish_blocked_by: agent.publishBlockedBy,
      version_id: agent.versionId,
    },
    knowledge: {
      memory_version_id: memoryVersionId,
      required_sources: params.blueprint.knowledge.required_sources,
      missing_facts: params.blueprint.knowledge.missing_facts,
    },
    automations: {
      planned: automations.planned,
      prepared: automations.prepared,
      materialized: automations.materialized,
      pending: automations.pending,
      state: automations.state,
      pointer_ids: automations.pointer_ids,
    },
    warnings,
  };
}
