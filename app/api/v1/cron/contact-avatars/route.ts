/**
 * GET/POST /api/v1/cron/contact-avatars
 *
 * Wrapper autenticado da sincronização de fotos. O trabalho real também é
 * executado pelo worker nativo para não depender de agendamento externo.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { sincronizarAvataresContatos } from "@/lib/contacts/avatar-sync";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ")
    ? auth.slice("Bearer ".length).trim()
    : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);

  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  try {
    const resultado = await sincronizarAvataresContatos({ requestId });
    return ok(resultado, { requestId });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error("[contact-avatars] sync failed", { detail, requestId });
    return fail("internal_error", detail, 500, { requestId });
  }
}

export const GET = handle;
export const POST = handle;
