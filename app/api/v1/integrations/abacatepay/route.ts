import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import { readConnection, saveConnection, removeConnection } from "@/lib/payment-providers/abacatepay/config";
import { fetchStore, AbacatePayError } from "@/lib/payment-providers/abacatepay/client";
import { fetchAbacatePayDashboard } from "@/lib/payment-providers/abacatepay/sync";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** Chaves reais medidas: `abc_dev_...`/`abc_prod_...`, mas o formato não é documentado como contrato — valida só forma de token, não o prefixo. */
const apiKeySchema = z
  .object({ apiKey: z.string().trim().min(16).max(512).regex(/^[\x21-\x7e]+$/) })
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
  const auth = await requireRole("manager", { requestId, resource: "abacatepay_integration" });
  if (!auth.ok) return auth.response;
  const mismatch = organizationMismatch(request, auth.org.orgId, requestId);
  if (mismatch) return mismatch;
  try {
    const connection = await readConnection(auth.org.orgId);
    if (!connection) return ok({ configured: false, dashboard: null, store: null }, { requestId, headers });
    const dashboard = await fetchAbacatePayDashboard(connection.apiKey);
    return ok(
      {
        configured: true,
        updated_at: connection.updatedAt,
        store: { id: connection.storeId, name: connection.storeName },
        dashboard,
      },
      { requestId, headers },
    );
  } catch (erro) {
    if (erro instanceof AbacatePayError) {
      return fail(
        erro.kind === "unauthorized" ? "abacatepay_unauthorized" : "abacatepay_unavailable",
        erro.message,
        erro.kind === "unauthorized" ? 409 : 503,
        { requestId, headers },
      );
    }
    return fail(
      "abacatepay_unavailable",
      "Não foi possível carregar a conexão com a AbacatePay. Tente novamente.",
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
    if (text.length > 2048) return fail("invalid_request", "Chave inválida.", 400, { requestId, headers });
    body = JSON.parse(text);
  } catch {
    return fail("invalid_request", "Chave inválida.", 400, { requestId, headers });
  }
  const parsed = apiKeySchema.safeParse(body);
  if (!parsed.success)
    return fail("validation_failed", "Informe uma chave de API válida.", 422, { requestId, headers });
  const auth = await requireRole("admin", { requestId, resource: "abacatepay_integration" });
  if (!auth.ok) return auth.response;
  const mismatch = organizationMismatch(request, auth.org.orgId, requestId);
  if (mismatch) return mismatch;
  try {
    const store = await fetchStore(parsed.data.apiKey);
    await saveConnection(auth.org.orgId, parsed.data.apiKey, { id: store.id, name: store.name });
    const dashboard = await fetchAbacatePayDashboard(parsed.data.apiKey);
    void audit({
      action: "abacatepay.connected",
      organizationId: auth.org.orgId,
      actorUserId: auth.user.id,
      resourceType: "abacatepay_integration",
      requestId,
      metadata: { store_id: store.id },
    });
    return ok({ configured: true, store, dashboard }, { requestId, headers });
  } catch (erro) {
    if (erro instanceof AbacatePayError) {
      return fail(
        erro.kind === "unauthorized" ? "abacatepay_unauthorized" : "abacatepay_unavailable",
        erro.kind === "unauthorized"
          ? "A AbacatePay recusou esta chave. Confira e tente de novo."
          : erro.message,
        erro.kind === "unauthorized" ? 422 : 503,
        { requestId, headers },
      );
    }
    return fail("abacatepay_unavailable", "Não foi possível salvar a conexão. Tente novamente.", 503, {
      requestId,
      headers,
    });
  }
}

export async function DELETE(request: Request) {
  const requestId = randomUUID();
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const auth = await requireRole("admin", { requestId, resource: "abacatepay_integration" });
  if (!auth.ok) return auth.response;
  const mismatch = organizationMismatch(request, auth.org.orgId, requestId);
  if (mismatch) return mismatch;
  try {
    await removeConnection(auth.org.orgId);
    void audit({
      action: "abacatepay.disconnected",
      organizationId: auth.org.orgId,
      actorUserId: auth.user.id,
      resourceType: "abacatepay_integration",
      requestId,
    });
    return ok({ configured: false, dashboard: null, store: null }, { requestId, headers });
  } catch {
    return fail("abacatepay_unavailable", "Não foi possível desconectar. Tente novamente.", 503, {
      requestId,
      headers,
    });
  }
}
