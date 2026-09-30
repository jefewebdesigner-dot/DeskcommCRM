import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", {
    requestId,
    resource: "crm_tasks",
  });
  if (!authz.ok) return authz.response;

  const { id } = await ctx.params;
  const supabase = await createClient();

  const { data: task, error: taskError } = await supabase
    .from("crm_tasks")
    .select(
      "id,title,description,due_date,priority,status,lead_id,contact_id,responsible_profile_id",
    )
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .maybeSingle();

  if (taskError) return fail("internal_error", taskError.message, 500, { requestId });
  if (!task) return fail("not_found", "Tarefa não encontrada.", 404, { requestId });

  const [leadResult, contactResult, conversationResult, organizationResult] = await Promise.all([
    task.lead_id
      ? supabase
          .from("crm_leads")
          .select(
            "id,title,status,pipeline_id,stage_id,value_cents,currency,last_activity_at,updated_at,crm_pipelines(name),crm_stages(name)",
          )
          .eq("organization_id", authz.org.orgId)
          .eq("id", task.lead_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    task.contact_id
      ? supabase
          .from("contacts")
          .select("id,name,display_name,phone_number,email,tags,last_activity_at")
          .eq("organization_id", authz.org.orgId)
          .eq("id", task.contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    task.contact_id
      ? supabase
          .from("conversations")
          .select(
            "id,status,last_message_preview,last_message_at,channel_session_id,updated_at",
          )
          .eq("organization_id", authz.org.orgId)
          .eq("contact_id", task.contact_id)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("organizations")
      .select("display_name")
      .eq("id", authz.org.orgId)
      .maybeSingle(),
  ]);

  const firstError =
    leadResult.error ??
    contactResult.error ??
    conversationResult.error ??
    organizationResult.error;
  if (firstError) return fail("internal_error", firstError.message, 500, { requestId });

  return ok(
    {
      task,
      lead: leadResult.data,
      contact: contactResult.data,
      conversation: conversationResult.data,
      organization: organizationResult.data,
    },
    { requestId },
  );
}
