import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { extractBearer } from "@/lib/mcp/auth";
import {
  provisionExternalWahaChannel,
} from "@/lib/tenants/provision-channel";
import {
  tenantProvisioningEnabled,
  verifyChannelCapability,
} from "@/lib/tenants/provisioning-capability";

export const dynamic = "force-dynamic";

const inputSchema = z
  .object({
    deployment_id: z.string().trim().min(1).max(120),
    display_name: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  if (!tenantProvisioningEnabled()) {
    return fail("not_found", "Not found.", 404, { requestId });
  }

  const capability = verifyChannelCapability(
    extractBearer(req.headers.get("authorization")),
  );
  if (!capability) {
    return fail("unauthenticated", "Capability inválida ou expirada.", 401, {
      requestId,
    });
  }

  const parsed = inputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors,
    });
  }

  if (parsed.data.deployment_id !== capability.external_id) {
    return fail("forbidden", "A capability não pertence a esta implantação.", 403, {
      requestId,
    });
  }

  try {
    const result = await provisionExternalWahaChannel({
      organizationId: capability.organization_id,
      integration: capability.integration,
      externalId: capability.external_id,
      displayName: parsed.data.display_name,
    });
    return ok(result, {
      requestId,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (reason === "waha_not_configured") {
      return fail("waha_not_configured", "O WhatsApp está indisponível nesta instalação.", 503, {
        requestId,
      });
    }
    if (reason === "managed_channel_archived") {
      return fail("channel_archived", "O canal gerenciado foi arquivado.", 409, {
        requestId,
      });
    }
    return fail("channel_provision_failed", "Não foi possível preparar o WhatsApp.", 500, {
      requestId,
      details: { reason },
    });
  }
}
