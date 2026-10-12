/**
 * GET /api/v1/cron/webhook-retry
 *
 * Reenvia as entregas de `call_webhook` que falharam por motivo passageiro
 * (destino fora do ar, timeout, 5xx). Um lote por chamada, com reserva por
 * linha: dois disparos simultâneos não reenviam a mesma entrega. Ver
 * `lib/automation/fila-de-webhooks.ts`.
 *
 * Auth: `Authorization: Bearer <INTERNAL_CRON_SECRET>` (fecha quando falta o
 * segredo). Mesma forma de `app/api/v1/cron/webhook-log-retention/route.ts`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { processarFila } from "@/lib/automation/fila-de-webhooks";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";

  const aceitos: string[] = [];
  if (env.INTERNAL_CRON_SECRET) aceitos.push(env.INTERNAL_CRON_SECRET);
  if (env.INTERNAL_SECRET) aceitos.push(env.INTERNAL_SECRET);

  if (aceitos.length === 0 || !provided || !aceitos.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  try {
    const resultado = await processarFila(createAdminClient());
    return ok(resultado, { requestId });
  } catch (error) {
    console.error("[webhook-retry] falha ao processar a fila", { requestId, error });
    return fail("internal_error", "Não foi possível processar a fila de webhooks.", 500, { requestId });
  }
}
