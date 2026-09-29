import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { buildLegacyImportPlan } from "@/lib/billing-export/legacy-import";

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
    const plan = await buildLegacyImportPlan(PERICIAIA_ORG_ID);
    // TEMPORÁRIO: entrega o plano completo (com dados pessoais) UMA vez, por HTTPS e
    // protegido pelo segredo de cron, para a importação rodar na VPS — as credenciais
    // do Stripe/billing só existem neste runtime. Remover este bloco depois da migração.
    if (new URL(req.url).searchParams.get("formato") === "plano-completo") {
      return new Response(JSON.stringify({ summary: plan.summary, entities: plan.entities }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store, private", "x-request-id": requestId },
      });
    }
    return ok(
      {
        configured: true,
        dryRun: true,
        summary: plan.summary,
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
