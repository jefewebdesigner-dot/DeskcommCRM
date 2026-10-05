import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import { syncAbacatePayToCrm } from "@/lib/payment-providers/abacatepay/sync";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

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

/**
 * Sincroniza manualmente a AbacatePay com o CRM — mesma classificação de
 * `lib/billing-export/crm-sync.ts`. `admin` (não `manager`): move card e
 * cria/atualiza contato em lote, mutação de maior alcance que ler o painel.
 */
export async function POST(request: Request) {
  const requestId = randomUUID();
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const auth = await requireRole("admin", { requestId, resource: "abacatepay_integration" });
  if (!auth.ok) return auth.response;
  const mismatch = organizationMismatch(request, auth.org.orgId, requestId);
  if (mismatch) return mismatch;
  try {
    const resultado = await syncAbacatePayToCrm(auth.org.orgId);
    if (!resultado.configured) {
      return fail("abacatepay_not_configured", "Conecte a AbacatePay antes de sincronizar.", 422, {
        requestId,
        headers,
      });
    }
    void audit({
      action: "abacatepay.synced",
      organizationId: auth.org.orgId,
      actorUserId: auth.user.id,
      resourceType: "abacatepay_integration",
      requestId,
      metadata: {
        contacts_created: resultado.contactsCreated,
        contacts_updated: resultado.contactsUpdated,
        deals_created: resultado.dealsCreated,
        deals_updated: resultado.dealsUpdated,
        deals_moved: resultado.dealsMoved,
        conflicts: resultado.conflicts,
        errors: resultado.errors,
      },
    });
    return ok(resultado, { requestId, headers });
  } catch {
    return fail("abacatepay_unavailable", "Não foi possível sincronizar agora. Tente novamente.", 503, {
      requestId,
      headers,
    });
  }
}
