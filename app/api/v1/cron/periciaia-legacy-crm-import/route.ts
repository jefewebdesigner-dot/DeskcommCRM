import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  fetchLegacyCrmExport,
  summarizeLegacyCrm,
} from "@/lib/billing-export/legacy-crm";

export const dynamic = "force-dynamic";

const PERICIAIA_ORG_ID = "9563e071-406b-4db2-aaa4-d08846d3267b";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);

  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  try {
    const result = await fetchLegacyCrmExport(PERICIAIA_ORG_ID);
    if (!result.configured || !result.data) {
      return ok({ configured: false, dryRun: true }, { requestId });
    }

    return ok(
      {
        configured: true,
        dryRun: true,
        summary: summarizeLegacyCrm(result.data),
      },
      { requestId },
    );
  } catch (error) {
    logger.error("[periciaia-legacy-crm-import] diagnóstico falhou", {
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    return fail("internal_error", "Diagnóstico do CRM legado falhou.", 500, { requestId });
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
