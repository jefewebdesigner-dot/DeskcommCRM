import { updateLeadHandler } from "@/app/api/v1/leads/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { registerAction } from "@/lib/automation/actions";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";
import {
  proximoResponsavelOperacional,
  responsavelDaTarefaExiste,
} from "@/lib/tarefas/responsaveis";

async function execute(
  ctx: ActionCtx,
  config: Record<string, unknown>,
): Promise<ActionResultDetail> {
  const lead = ctx.context.lead as
    | { id: string; responsible_profile_id?: string | null }
    | undefined;
  if (!lead) {
    return {
      type: "assign_operational_responsible",
      status: "skipped",
      detail: { reason: "no_lead" },
    };
  }

  const mode = config.mode === "fixed" ? "fixed" : "round_robin";
  let profileId: string | null = null;

  if (mode === "fixed") {
    const candidate = typeof config.profile_id === "string" ? config.profile_id : "";
    if (!candidate) {
      return {
        type: "assign_operational_responsible",
        status: "failed",
        error: "profile_id_required",
      };
    }
    if (!(await responsavelDaTarefaExiste(ctx.organizationId, candidate))) {
      return {
        type: "assign_operational_responsible",
        status: "failed",
        error: "responsible_profile_not_found",
      };
    }
    profileId = candidate;
  } else {
    const profile = await proximoResponsavelOperacional(ctx.organizationId);
    profileId = profile?.id ?? null;
    if (!profileId) {
      return {
        type: "assign_operational_responsible",
        status: "skipped",
        detail: { reason: "no_active_responsible_profiles" },
      };
    }
  }

  if (lead.responsible_profile_id === profileId) {
    return {
      type: "assign_operational_responsible",
      status: "success",
      detail: { responsible_profile_id: profileId, unchanged: true },
    };
  }

  const handlerCtx: HandlerCtx = {
    organization_id: ctx.organizationId,
    actor: { type: "webhook_source", id: ctx.ruleId },
    requestId: `rule:${ctx.ruleId}`,
  };

  try {
    const updated = await updateLeadHandler(ctx.admin, handlerCtx, lead.id, {
      responsible_profile_id: profileId,
    });
    ctx.context.lead = { ...(ctx.context.lead as Record<string, unknown>), ...updated };
    return {
      type: "assign_operational_responsible",
      status: "success",
      detail: { responsible_profile_id: profileId, mode },
    };
  } catch (error) {
    return {
      type: "assign_operational_responsible",
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

registerAction({ type: "assign_operational_responsible", execute });
