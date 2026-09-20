import { createHash } from "node:crypto";

import { publishAgentVersion } from "@/lib/ai/agents/publish";
import type { Json } from "@/lib/database.types";
import type { FlowGraph } from "@/lib/followup/graph-schema";
import { triggerConfigSchema } from "@/lib/followup/api-schemas";
import { publishFollowupFlowVersion } from "@/lib/followup/publish";
import { validateFlowForPublish } from "@/lib/followup/validate-publish";
import type { SalesTwinBlueprint } from "@/lib/schemas/tenant-blueprint";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;
type Warning = { code: string; message: string };
type Automation = SalesTwinBlueprint["automations"][number];
type Stage = { id: string; name: string; is_won: boolean; is_lost: boolean };

export type SalesTwinAutomationResult = {
  planned: number;
  prepared: number;
  materialized: number;
  pending: number;
  state: "none" | "active" | "prepared_waiting_channel" | "partial";
  pointer_ids: string[];
};

export function erroDeSurfaceDeFollowupAusente(error: unknown): boolean {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  return /Could not find the 'surface' column of 'followup_flow_pointers' in the schema cache/i.test(
    message,
  );
}

function avisarSurfaceLegada(warnings: Warning[]): void {
  if (warnings.some((w) => w.code === "followup_pointer_legacy_without_surface")) return;
  warnings.push({
    code: "followup_pointer_legacy_without_surface",
    message:
      "O banco ainda não tem a coluna surface dos fluxos; a automação foi preparada em modo compatível.",
  });
}

type PreparedSpec =
  | {
      ok: true;
      trigger: Json;
      graph: FlowGraph;
    }
  | {
      ok: false;
      reason:
        | "unsupported_action"
        | "unsupported_trigger"
        | "stage_not_found"
        | "delay_out_of_range"
        | "generated_flow_invalid";
    };

function normalizar(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compactId(deploymentId: string): string {
  return createHash("sha256").update(deploymentId).digest("hex").slice(0, 8);
}

function nomeGerenciado(deploymentId: string, index: number, name: string): string {
  return `ST ${compactId(deploymentId)} · ${index + 1} · ${name.trim() || "Automação"}`.slice(
    0,
    80,
  );
}

function delayAceito(minutes: number): boolean {
  return minutes === 0 || (minutes >= 5 && minutes <= 90 * 24 * 60);
}

function labelDelay(minutes: number): string {
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return days === 1 ? "Espera 1 dia" : `Espera ${days} dias`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "Espera 1 hora" : `Espera ${hours} horas`;
  }
  return `Espera ${minutes} min`;
}

function criarGrafo(params: {
  delayMinutes: number;
  automation: Automation;
  organizationName: string;
  context: string;
}): FlowGraph {
  const nodes: FlowGraph["nodes"] = [
    {
      id: "inicio",
      type: "trigger",
      label: "Início",
      position: { x: 0, y: 0 },
      config: {},
    },
  ];
  const edges: FlowGraph["edges"] = [];

  let source = "inicio";
  let x = 260;

  if (params.delayMinutes > 0) {
    nodes.push({
      id: "espera",
      type: "wait",
      label: labelDelay(params.delayMinutes),
      position: { x, y: 0 },
      config: {
        mode: "fixed",
        duration_ms: params.delayMinutes * 60_000,
      },
    });
    edges.push({
      id: "inicio__espera",
      source: "inicio",
      target: "espera",
      priority: 0,
      condition: { type: "always" },
    });
    source = "espera";
    x += 260;
  }

  const goal = params.automation.goal.trim() || params.automation.name.trim();
  const hint = [
    `Escreva uma mensagem curta e natural de follow-up para ${params.organizationName}.`,
    params.context,
    goal ? `Objetivo: ${goal}.` : "",
    "Use somente fatos confirmados no contexto do CRM e na base de conhecimento.",
    "Não invente preço, desconto, disponibilidade, prazo, resultado, depoimento, certificação ou condição comercial.",
    "Convide a pessoa a responder e respeite eventual pedido para parar o contato.",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1000);

  nodes.push({
    id: "mensagem",
    type: "action",
    label: params.automation.name.slice(0, 60),
    position: { x, y: 0 },
    config: {
      mode: "ai_message",
      prompt_hint: hint,
    },
  });
  edges.push({
    id: `${source}__mensagem`,
    source,
    target: "mensagem",
    priority: 0,
    condition: { type: "always" },
  });

  nodes.push({
    id: "fim",
    type: "end",
    label: "Fim",
    position: { x: x + 260, y: 0 },
    config: {
      outcome: "custom",
      note: "Follow-up Sales Twin enviado.",
    },
  });
  edges.push({
    id: "mensagem__fim",
    source: "mensagem",
    target: "fim",
    priority: 0,
    condition: { type: "always" },
  });

  return { nodes, edges };
}

export function prepararAutomacao(
  automation: Automation,
  organizationName: string,
  stages: Stage[],
): PreparedSpec {
  const action = normalizar(automation.action);
  const actionTokens = new Set(action.split(/\s+/).filter(Boolean));
  const supportedAction =
    actionTokens.has("whatsapp") ||
    actionTokens.has("followup") ||
    (actionTokens.has("follow") && actionTokens.has("up")) ||
    actionTokens.has("mensagem") ||
    actionTokens.has("message");
  if (!supportedAction) {
    return { ok: false, reason: "unsupported_action" };
  }

  const rawTrigger = automation.trigger.trim();
  const trigger = normalizar(rawTrigger);
  const delay = automation.delay_minutes;
  let triggerConfig: unknown;
  let graphDelay = 0;
  let context = "";

  const explicitStage = rawTrigger.match(/^(?:stage|etapa)\s*[:=]\s*(.+)$/i);
  const exactStage = stages.find((stage) => normalizar(stage.name) === trigger);
  const stageName = explicitStage?.[1]?.trim();
  const selectedStage = stageName
    ? stages.find((stage) => normalizar(stage.name) === normalizar(stageName))
    : exactStage;

  if (
    trigger === "silence" ||
    trigger === "sem resposta" ||
    trigger === "lead sem resposta" ||
    trigger.includes("sem resposta")
  ) {
    if (delay < 5 || delay > 10_080) return { ok: false, reason: "delay_out_of_range" };
    triggerConfig = {
      kind: "silence",
      params: { threshold_minutes: delay },
      cancel_on_reply: true,
    };
    context = `O contato está há ${delay} minutos sem responder.`;
  } else if (
    trigger === "appointment no show" ||
    trigger === "no show" ||
    trigger === "nao compareceu" ||
    trigger.includes("nao compareceu") ||
    trigger.includes("falta")
  ) {
    if (!delayAceito(delay)) return { ok: false, reason: "delay_out_of_range" };
    triggerConfig = {
      kind: "appointment_no_show",
      cancel_on_reply: true,
    };
    graphDelay = delay;
    context = "A pessoa não compareceu ao compromisso registrado.";
  } else if (selectedStage) {
    if (!delayAceito(delay)) return { ok: false, reason: "delay_out_of_range" };
    triggerConfig = {
      kind: "stage_change",
      params: { stage_id: selectedStage.id },
      cancel_on_reply: true,
    };
    graphDelay = delay;
    context = `O negócio entrou na etapa «${selectedStage.name}».`;
  } else if (explicitStage) {
    return { ok: false, reason: "stage_not_found" };
  } else if (trigger === "conversation end" || trigger === "conversa encerrada") {
    if (!delayAceito(delay)) return { ok: false, reason: "delay_out_of_range" };
    triggerConfig = {
      kind: "conversation_end",
      params: {},
      cancel_on_reply: true,
    };
    graphDelay = delay;
    context = "A conversa foi encerrada e este é um contato de retomada.";
  } else if (trigger === "case opened" || trigger === "caso aberto") {
    if (!delayAceito(delay)) return { ok: false, reason: "delay_out_of_range" };
    triggerConfig = {
      kind: "case_opened",
      params: {},
      cancel_on_reply: true,
    };
    graphDelay = delay;
    context = "Um novo caso foi aberto para a pessoa.";
  } else if (trigger === "webhook") {
    if (!delayAceito(delay)) return { ok: false, reason: "delay_out_of_range" };
    triggerConfig = { kind: "webhook", cancel_on_reply: true };
    graphDelay = delay;
    context = "Uma integração externa disparou este follow-up.";
  } else {
    return { ok: false, reason: "unsupported_trigger" };
  }

  const parsedTrigger = triggerConfigSchema.safeParse(triggerConfig);
  if (!parsedTrigger.success) return { ok: false, reason: "unsupported_trigger" };

  const graph = criarGrafo({
    delayMinutes: graphDelay,
    automation,
    organizationName,
    context,
  });
  const valid = validateFlowForPublish(graph);
  if (!valid.ok) return { ok: false, reason: "generated_flow_invalid" };

  return {
    ok: true,
    trigger: parsedTrigger.data as unknown as Json,
    graph,
  };
}

async function reconciliarPonteiros(params: {
  admin: Admin;
  organizationId: string;
  ownerId: string;
  deploymentId: string;
  organizationName: string;
  automations: Automation[];
  stages: Stage[];
  replay: boolean;
  warnings: Warning[];
}): Promise<string[]> {
  const prefix = `ST ${compactId(params.deploymentId)} · `;
  const desiredNames = new Set<string>();
  const publishedIds: string[] = [];
  const limit = Math.min(params.automations.length, 20);

  if (params.automations.length > 20) {
    params.warnings.push({
      code: "automation_limit_exceeded",
      message: "O agente aceita no máximo 20 fluxos de follow-up; os excedentes ficaram pendentes.",
    });
  }

  for (let index = 0; index < limit; index++) {
    const automation = params.automations[index]!;
    const name = nomeGerenciado(params.deploymentId, index, automation.name);
    const spec = prepararAutomacao(automation, params.organizationName, params.stages);

    if (!spec.ok) {
      params.warnings.push({
        code: `automation_${index + 1}_${spec.reason}`,
        message: `A automação «${automation.name}» ficou pendente: ${spec.reason}.`,
      });
      continue;
    }

    desiredNames.add(name);

    const { data: existing, error: existingError } = await params.admin
      .from("followup_flow_pointers")
      .select("id,status,active_version_id")
      .eq("organization_id", params.organizationId)
      .eq("name", name)
      .maybeSingle();
    if (existingError) {
      throw new Error("blueprint: followup pointer read failed: " + existingError.message);
    }

    let pointer = existing;
    const basePointerPayload = {
      draft_graph: spec.graph as unknown as Json,
      trigger_config: spec.trigger,
      handoff_policy: "pause",
    };
    if (!pointer) {
      const createPayload = {
        organization_id: params.organizationId,
        name,
        ...basePointerPayload,
      };
      let result = await params.admin
        .from("followup_flow_pointers")
        .insert({ ...createPayload, surface: "crm_automation" })
        .select("id,status,active_version_id")
        .single();
      if (result.error && erroDeSurfaceDeFollowupAusente(result.error)) {
        avisarSurfaceLegada(params.warnings);
        result = await params.admin
          .from("followup_flow_pointers")
          .insert(createPayload)
          .select("id,status,active_version_id")
          .single();
      }
      if (result.error || !result.data) {
        throw new Error(
          "blueprint: followup pointer create failed: " + (result.error?.message ?? "no_row"),
        );
      }
      pointer = result.data;
    } else if (!params.replay || pointer.status !== "active") {
      let result = await params.admin
        .from("followup_flow_pointers")
        .update({ ...basePointerPayload, surface: "crm_automation" })
        .eq("organization_id", params.organizationId)
        .eq("id", pointer.id)
        .select("id,status,active_version_id")
        .single();
      if (result.error && erroDeSurfaceDeFollowupAusente(result.error)) {
        avisarSurfaceLegada(params.warnings);
        result = await params.admin
          .from("followup_flow_pointers")
          .update(basePointerPayload)
          .eq("organization_id", params.organizationId)
          .eq("id", pointer.id)
          .select("id,status,active_version_id")
          .single();
      }
      if (result.error || !result.data) {
        throw new Error(
          "blueprint: followup pointer update failed: " + (result.error?.message ?? "no_row"),
        );
      }
      pointer = result.data;
    }

    if (!params.replay || pointer.status !== "active" || !pointer.active_version_id) {
      const published = await publishFollowupFlowVersion(params.admin, {
        orgId: params.organizationId,
        pointerId: pointer.id,
        graph: spec.graph,
        createdBy: params.ownerId,
      });
      if (!published.ok) {
        const { error: disableError } = await params.admin
          .from("followup_flow_pointers")
          .update({ status: "disabled" })
          .eq("organization_id", params.organizationId)
          .eq("id", pointer.id);
        if (disableError) {
          throw new Error(
            "blueprint: failed followup could not be disabled: " + disableError.message,
          );
        }
        params.warnings.push({
          code: `automation_${index + 1}_publish_failed`,
          message: `O fluxo «${automation.name}» foi criado, mas não pôde ser publicado: ${published.message}.`,
        });
        continue;
      }
    }

    publishedIds.push(pointer.id);
  }

  const { data: managed, error: managedError } = await params.admin
    .from("followup_flow_pointers")
    .select("id,name,status")
    .eq("organization_id", params.organizationId)
    .like("name", `${prefix}%`);
  if (managedError) {
    throw new Error("blueprint: managed followups read failed: " + managedError.message);
  }

  const staleIds = (managed ?? [])
    .filter((row) => !desiredNames.has(row.name) && row.status !== "disabled")
    .map((row) => row.id);
  if (staleIds.length > 0) {
    const { error } = await params.admin
      .from("followup_flow_pointers")
      .update({ status: "disabled" })
      .eq("organization_id", params.organizationId)
      .in("id", staleIds);
    if (error) {
      throw new Error("blueprint: stale followups disable failed: " + error.message);
    }
  }

  return publishedIds;
}

async function armarNoAgente(params: {
  admin: Admin;
  organizationId: string;
  ownerId: string;
  agentId: string;
  previousManagedIds: string[];
  pointerIds: string[];
  warnings: Warning[];
}): Promise<{ activeManagedIds: string[]; versionId: string | null; waitingChannel: boolean }> {
  const { data: agent, error: agentError } = await params.admin
    .from("ai_agents")
    .select("published_version_id")
    .eq("organization_id", params.organizationId)
    .eq("id", params.agentId)
    .maybeSingle();
  if (agentError) throw new Error("blueprint: agent followup read failed: " + agentError.message);
  if (!agent?.published_version_id) {
    return { activeManagedIds: [], versionId: null, waitingChannel: true };
  }

  const { data: version, error: versionError } = await params.admin
    .from("ai_agent_versions")
    .select(
      "system_prompt,provider,model,credential_id,tool_ids,trigger_config,channel_session_id,max_steps,token_budget,cost_budget_cents,history_message_window,history_token_window,handoff_keywords,handoff_tool_enabled,cases_enabled,split_messages,split_max_chars,followup,operator_enabled,operator_model,operator_tool_ids,pipeline_ids,knowledge_source_ids",
    )
    .eq("organization_id", params.organizationId)
    .eq("agent_id", params.agentId)
    .eq("id", agent.published_version_id)
    .maybeSingle();
  if (versionError || !version) {
    params.warnings.push({
      code: "agent_followup_version_read_failed",
      message:
        versionError?.message ??
        "A versão publicada do agente não foi encontrada para armar os follow-ups.",
    });
    return {
      activeManagedIds: [],
      versionId: agent.published_version_id,
      waitingChannel: false,
    };
  }

  const current =
    version.followup && typeof version.followup === "object"
      ? (version.followup as Record<string, unknown>)
      : {};
  const currentIds = Array.isArray(current.flow_pointer_ids)
    ? current.flow_pointer_ids.filter((v): v is string => typeof v === "string")
    : [];
  const previous = new Set(params.previousManagedIds);
  const manualIds = currentIds.filter((id) => !previous.has(id));
  const capacity = Math.max(0, 20 - manualIds.length);
  const managedIds = params.pointerIds.slice(0, capacity);
  if (managedIds.length < params.pointerIds.length) {
    params.warnings.push({
      code: "automation_agent_capacity_exceeded",
      message:
        "O agente já possui outros follow-ups e não tem espaço para armar todas as automações do Sales Twin.",
    });
  }

  const desiredIds = [...manualIds, ...managedIds];
  const sameIds =
    currentIds.length === desiredIds.length &&
    [...currentIds].sort().every((id, index) => id === [...desiredIds].sort()[index]);
  const sameEnabled = current.enabled === desiredIds.length > 0;
  if (sameIds && sameEnabled) {
    return {
      activeManagedIds: managedIds,
      versionId: agent.published_version_id,
      waitingChannel: false,
    };
  }

  const { data: latest, error: latestError } = await params.admin
    .from("ai_agent_versions")
    .select("version_number")
    .eq("organization_id", params.organizationId)
    .eq("agent_id", params.agentId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) {
    throw new Error("blueprint: followup agent version number failed: " + latestError.message);
  }

  const { data: draft, error: draftError } = await params.admin
    .from("ai_agent_versions")
    .insert({
      organization_id: params.organizationId,
      agent_id: params.agentId,
      version_number: ((latest?.version_number as number | null) ?? 0) + 1,
      provisioning_origin: "sales_twin",
      system_prompt: version.system_prompt,
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
      followup: {
        ...current,
        enabled: desiredIds.length > 0,
        flow_pointer_ids: desiredIds,
        send_window: current.send_window ?? null,
      } as Json,
      operator_enabled: version.operator_enabled,
      operator_model: version.operator_model,
      operator_tool_ids: version.operator_tool_ids,
      pipeline_ids: version.pipeline_ids,
      knowledge_source_ids: version.knowledge_source_ids,
      status: "draft",
      created_by: params.ownerId,
    })
    .select("id")
    .single();
  if (draftError || !draft) {
    params.warnings.push({
      code: "agent_followup_version_create_failed",
      message:
        draftError?.message ?? "Não foi possível criar a versão do agente com os follow-ups.",
    });
    return {
      activeManagedIds: [],
      versionId: agent.published_version_id,
      waitingChannel: false,
    };
  }

  const published = await publishAgentVersion(params.admin, {
    orgId: params.organizationId,
    agentId: params.agentId,
    versionId: draft.id,
  });
  if (!published.ok) {
    params.warnings.push({
      code: "agent_followup_publish_failed",
      message: `Os follow-ups foram preparados, mas o agente não pôde ser rearmado: ${published.message}.`,
    });
    return {
      activeManagedIds: [],
      versionId: agent.published_version_id,
      waitingChannel:
        published.code === "channel_session_not_found" ||
        published.code === "channel_session_offline",
    };
  }

  return {
    activeManagedIds: managedIds,
    versionId: draft.id,
    waitingChannel: false,
  };
}

export async function aplicarAutomacoesDoBlueprint(params: {
  admin: Admin;
  organizationId: string;
  ownerId: string;
  deploymentId: string;
  organizationName: string;
  automations: Automation[];
  stages: Stage[];
  agentId: string;
  replay: boolean;
  previousManagedIds?: string[];
  warnings: Warning[];
}): Promise<SalesTwinAutomationResult & { agentVersionId: string | null }> {
  const planned = params.automations.length;

  const pointerIds = await reconciliarPonteiros({
    admin: params.admin,
    organizationId: params.organizationId,
    ownerId: params.ownerId,
    deploymentId: params.deploymentId,
    organizationName: params.organizationName,
    automations: params.automations,
    stages: params.stages,
    replay: params.replay,
    warnings: params.warnings,
  });

  const armed = await armarNoAgente({
    admin: params.admin,
    organizationId: params.organizationId,
    ownerId: params.ownerId,
    agentId: params.agentId,
    previousManagedIds: params.previousManagedIds ?? [],
    pointerIds,
    warnings: params.warnings,
  });

  const prepared = pointerIds.length;
  const materialized = armed.activeManagedIds.length;
  const pending = Math.max(0, planned - materialized);
  let state: SalesTwinAutomationResult["state"];
  if (planned === 0) state = "none";
  else if (materialized === planned) state = "active";
  else if (prepared === planned && armed.waitingChannel) state = "prepared_waiting_channel";
  else state = "partial";

  return {
    planned,
    prepared,
    materialized,
    pending,
    state,
    pointer_ids: pointerIds,
    agentVersionId: armed.versionId,
  };
}
