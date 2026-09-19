import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { extractBearer } from "@/lib/mcp/auth";
import { salesTwinBlueprintSchema, type SalesTwinBlueprint } from "@/lib/schemas/tenant-blueprint";
import { validateRequest } from "@/lib/schemas/_validate";
import { applySalesTwinBlueprint } from "@/lib/tenants/apply-blueprint";
import {
  tenantProvisioningEnabled,
  verifyBlueprintCapability,
} from "@/lib/tenants/provisioning-capability";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/tenants/provision-blueprint
 *
 * Aplica o Business Blueprint do Zheus na organização que acabou de ser
 * provisionada. Não aceita cookie/admin nem o segredo global da instalação:
 * somente uma capability curta tenant:blueprint, emitida por /tenants/provision
 * e amarrada a UMA organização + integração + external_id.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  if (!tenantProvisioningEnabled()) {
    return fail("not_found", "Not found.", 404, { requestId });
  }

  const token = extractBearer(req.headers.get("authorization"));
  const capability = verifyBlueprintCapability(token);
  if (!capability) {
    return fail("unauthenticated", "Capability inválida ou expirada.", 401, { requestId });
  }

  let input: SalesTwinBlueprint;
  try {
    input = await validateRequest(salesTwinBlueprintSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  if (input.deployment_id !== capability.external_id) {
    return fail("forbidden", "A capability não pertence a esta implantação.", 403, { requestId });
  }

  try {
    const result = await applySalesTwinBlueprint({
      organizationId: capability.organization_id,
      integration: capability.integration,
      externalId: capability.external_id,
      blueprint: input,
      requestId,
    });
    return ok(result, {
      requestId,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return fail(
      "blueprint_apply_failed",
      "Não foi possível aplicar o Blueprint nesta organização.",
      500,
      {
        requestId,
        details: {
          reason: err instanceof Error ? err.message : String(err),
        },
      },
    );
  }
}
