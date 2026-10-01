import { registerAction } from "@/lib/automation/actions";
import { renderTemplate } from "@/lib/automation/template";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";

const PRIORIDADES = new Set(["low", "medium", "high", "urgent"]);

async function execute(
  ctx: ActionCtx,
  config: Record<string, unknown>,
): Promise<ActionResultDetail> {
  const lead = ctx.context.lead as
    | {
        id: string;
        contact_id?: string | null;
        owner_user_id?: string | null;
        owner_kind?: string | null;
        responsible_profile_id?: string | null;
      }
    | undefined;
  if (!lead) {
    return { type: "create_task", status: "skipped", detail: { reason: "no_lead" } };
  }

  const titleTemplate =
    typeof config.title_template === "string" ? config.title_template.trim() : "";
  if (!titleTemplate) {
    return {
      type: "create_task",
      status: "failed",
      error: "title_template_required",
    };
  }

  const title = renderTemplate(titleTemplate, ctx.context).trim().slice(0, 255);
  const description =
    typeof config.description_template === "string"
      ? renderTemplate(config.description_template, ctx.context).trim().slice(0, 2000)
      : null;
  const dueInHours =
    typeof config.due_in_hours === "number" && Number.isFinite(config.due_in_hours)
      ? Math.max(0, Math.min(2160, Math.round(config.due_in_hours)))
      : 24;
  const priority =
    typeof config.priority === "string" && PRIORIDADES.has(config.priority)
      ? config.priority
      : "medium";

  // Reprocessamento do mesmo evento não duplica uma obrigação viva.
  const { data: existente, error: existenteError } = await ctx.admin
    .from("crm_tasks")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("lead_id", lead.id)
    .eq("title", title)
    .in("status", ["pending", "in_progress"])
    .limit(1)
    .maybeSingle();
  if (existenteError) {
    return { type: "create_task", status: "failed", error: existenteError.message };
  }
  if (existente) {
    return {
      type: "create_task",
      status: "success",
      detail: { task_id: existente.id, deduplicated: true },
    };
  }

  const dueDate = new Date(Date.now() + dueInHours * 3_600_000).toISOString();
  const { data: tarefa, error } = await ctx.admin
    .from("crm_tasks")
    .insert({
      organization_id: ctx.organizationId,
      title,
      description: description || null,
      due_date: dueDate,
      priority,
      status: "pending",
      lead_id: lead.id,
      contact_id: lead.contact_id ?? null,
      assigned_to: lead.owner_kind === "user" ? (lead.owner_user_id ?? null) : null,
      responsible_profile_id: lead.responsible_profile_id ?? null,
      created_by: null,
    })
    .select("id")
    .single();

  if (error || !tarefa) {
    return {
      type: "create_task",
      status: "failed",
      error: error?.message ?? "task_insert_failed",
    };
  }

  return {
    type: "create_task",
    status: "success",
    detail: {
      task_id: tarefa.id,
      due_date: dueDate,
      responsible_profile_id: lead.responsible_profile_id ?? null,
    },
  };
}

registerAction({ type: "create_task", execute });
