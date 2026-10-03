import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { refreshCatalog } from "@/lib/agenda/google/calendar-executor";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
export async function POST(req: Request) {
  const denied = await requireSupportWrite();if (denied) return denied;
  const requestId = randomUUID();const auth = await requireRole("agent", { requestId, resource: "agenda" });if (!auth.ok) return auth.response;
  const parsed = z.object({ connection_id: z.uuid() }).strict().safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Confira a conexão escolhida.", 422, { requestId });
  const { data, error } = await (await createClient()).from("calendar_connections").select("id").eq("organization_id", auth.org.orgId).eq("user_id", auth.user.id).eq("id", parsed.data.connection_id).maybeSingle();
  if (error || !data) return fail("not_found", "Conexão indisponível.", 404, { requestId });
  try {
    await refreshCatalog(createAdminClient(), auth.org.orgId, data.id);
    void audit({ action: "agenda.google_catalog_updated", organizationId: auth.org.orgId, actorUserId: auth.user.id, resourceType: "calendar_connection", resourceId: data.id, requestId });
    return ok({ refreshed: true }, { requestId });
  } catch (err) {
    // Catch vazio escondia a causa real (sem logger.error nem audit) — mesma
    // classe de bug já corrigida nas rotas de webhook WAHA nesta instalação.
    const mensagem = err instanceof Error ? err.message : String(err);
    logger.error("[agenda.google_catalog_updated] refreshCatalog falhou", {
      request_id: requestId,
      organization_id: auth.org.orgId,
      connection_id: data.id,
      error: mensagem,
    });
    return fail("conflict", "Não foi possível atualizar. Confira a conexão e tente novamente.", 409, {
      requestId,
      details: { causa: mensagem },
    });
  }
}
