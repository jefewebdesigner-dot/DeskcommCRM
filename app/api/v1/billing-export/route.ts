import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import { readConnection, saveConnection, removeConnection } from "@/lib/billing-export/config";
import { fetchBillingDashboard } from "@/lib/billing-export/fetch";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const credentialSchema = z
  .object({
    token: z
      .string()
      .trim()
      .min(16)
      .max(2048)
      .regex(/^[A-Za-z0-9._~+\/-]+={0,2}$/),
  })
  .strict();

function organizationMismatch(request: Request, organizationId: string, requestId: string) {
  const expected = z.uuid().safeParse(request.headers.get("X-Organization-Id"));
  if (!expected.success || expected.data !== organizationId) {
    return fail(
      "organization_changed",
      "A organização ativa mudou. Recarregue a página antes de continuar.",
      409,
      { requestId, headers },
    );
  }
  return null;
}

export async function GET(request: Request) {
  const requestId = randomUUID();
  const auth = await requireRole("manager", { requestId, resource: "billing_export" });
  if (!auth.ok) return auth.response;
  const mismatch = organizationMismatch(request, auth.org.orgId, requestId);
  if (mismatch) return mismatch;
  try {
    const connection = await readConnection(auth.org.orgId);
    if (!connection) return ok({ configured: false, dashboard: null }, { requestId, headers });
    return ok(
      {
        configured: true,
        updated_at: connection.updated_at,
        dashboard: await fetchBillingDashboard(connection.token),
      },
      { requestId, headers },
    );
  } catch {
    return fail(
      "billing_unavailable",
      "Não foi possível carregar a conexão de cobrança. Tente novamente ou revise a configuração.",
      503,
      { requestId, headers },
    );
  }
}

export async function PUT(request: Request) {
  const requestId = randomUUID();
  const denied = await requireSupportWrite();
  if (denied) return denied;
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 4096)
      return fail("invalid_request", "Configuração inválida.", 400, { requestId, headers });
    body = JSON.parse(text);
  } catch {
    return fail("invalid_request", "Configuração inválida.", 400, { requestId, headers });
  }
  const parsed = credentialSchema.safeParse(body);
  if (!parsed.success)
    return fail("validation_failed", "Informe um token válido.", 422, { requestId, headers });
  const auth = await requireRole("admin", { requestId, resource: "billing_export" });
  if (!auth.ok) return auth.response;
  const mismatch = organizationMismatch(request, auth.org.orgId, requestId);
  if (mismatch) return mismatch;
  try {
    const dashboard = await fetchBillingDashboard(parsed.data.token);
    if (!dashboard.stripe.ok || !dashboard.other.ok) {
      return fail(
        "billing_connection_failed",
        "Não foi possível validar as duas fontes. Confira o token e tente novamente. A conexão anterior foi preservada.",
        422,
        { requestId, headers },
      );
    }
    await saveConnection(auth.org.orgId, parsed.data.token);
    void audit({
      action: "billing_export.connected",
      organizationId: auth.org.orgId,
      actorUserId: auth.user.id,
      resourceType: "billing_export",
      requestId,
    });
    return ok({ configured: true, dashboard }, { requestId, headers });
  } catch {
    return fail("billing_unavailable", "Não foi possível salvar a conexão. Tente novamente.", 503, {
      requestId,
      headers,
    });
  }
}

export async function DELETE(request: Request) {
  const requestId = randomUUID();
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const auth = await requireRole("admin", { requestId, resource: "billing_export" });
  if (!auth.ok) return auth.response;
  const mismatch = organizationMismatch(request, auth.org.orgId, requestId);
  if (mismatch) return mismatch;
  try {
    await removeConnection(auth.org.orgId);
    void audit({
      action: "billing_export.disconnected",
      organizationId: auth.org.orgId,
      actorUserId: auth.user.id,
      resourceType: "billing_export",
      requestId,
    });
    return ok({ configured: false, dashboard: null }, { requestId, headers });
  } catch {
    return fail("billing_unavailable", "Não foi possível desconectar. Tente novamente.", 503, {
      requestId,
      headers,
    });
  }
}
