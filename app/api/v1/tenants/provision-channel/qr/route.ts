import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { extractBearer } from "@/lib/mcp/auth";
import { loadProvisionedWahaChannel } from "@/lib/tenants/provision-channel";
import {
  tenantProvisioningEnabled,
  verifyChannelCapability,
} from "@/lib/tenants/provisioning-capability";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
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

  const channel = await loadProvisionedWahaChannel({
    organizationId: capability.organization_id,
    integration: capability.integration,
    externalId: capability.external_id,
  });
  if (!channel) {
    return fail("not_found", "Canal ainda não preparado.", 404, { requestId });
  }
  if (channel.archived_at) {
    return fail("channel_archived", "O canal gerenciado foi arquivado.", 409, {
      requestId,
    });
  }
  if (channel.status === "WORKING") {
    return fail("already_paired", "O WhatsApp já está conectado.", 409, {
      requestId,
      headers: { "X-Channel-State": "WORKING" },
    });
  }

  const baseUrl = process.env.WAHA_API_BASE_URL;
  const apiKey = process.env.WAHA_API_KEY;
  if (!baseUrl || !apiKey || apiKey === "dev_plaintext_change_me") {
    return fail("waha_not_configured", "O WhatsApp está indisponível nesta instalação.", 503, {
      requestId,
    });
  }

  const upstream = await fetch(
    `${baseUrl}/api/${encodeURIComponent(channel.waha_session_name ?? "")}/auth/qr?format=image`,
    {
      headers: { "X-Api-Key": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
  ).catch(() => null);

  if (!upstream) {
    return fail("waha_unreachable", "O serviço do WhatsApp não respondeu.", 502, {
      requestId,
    });
  }
  if (!upstream.ok) {
    return fail("qr_not_ready", "O QR ainda não está pronto.", 409, {
      requestId,
      headers: { "Retry-After": "2" },
    });
  }

  return new NextResponse(await upstream.arrayBuffer(), {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "image/png",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
