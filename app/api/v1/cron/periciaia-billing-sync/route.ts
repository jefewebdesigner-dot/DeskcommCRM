/**
 * GET /api/v1/cron/periciaia-billing-sync
 *
 * Puxa a fonte de billing conectada (Stripe + PIX/manual, ver
 * lib/billing-export/) e cria/atualiza contato + negócio no CRM para cada
 * cliente pagante — para o time ver cliente, histórico e situação financeira
 * no mesmo lugar, sem abrir o admin do PeríciaIA à parte.
 *
 * Roda por organização: hoje só a PeríciaIA (slug `periciaia`) tem uma conexão
 * de billing salva (`billing_export_connections`). Organização sem conexão é
 * pulada em silêncio — não é erro, é "não configurado".
 *
 * Auth: mesmo contrato dos demais crons (Bearer INTERNAL_CRON_SECRET|
 * INTERNAL_SECRET, fail-closed). Nesta instância (Vercel) o agendamento vem de
 * `vercel.json` (`crons`), que a Vercel dispara com `Authorization: Bearer
 * $CRON_SECRET` — `lib/env.ts` já copia `CRON_SECRET` para
 * `INTERNAL_CRON_SECRET` em produção. No self-host o `scheduler` do
 * `docker-compose.prod.yml` chama com `Bearer $INTERNAL_SECRET`
 * (docker/scheduler/entrypoint.sh).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncBillingToCrm, type SyncResult } from "@/lib/billing-export/crm-sync";

export const dynamic = "force-dynamic";

interface RunResult {
  organizationsWithConnection: number;
  totals: SyncResult;
}

export async function runPericiaiaBillingSync(
  admin: ReturnType<typeof createAdminClient>,
  requestId: string,
): Promise<RunResult> {
  const totals: SyncResult = {
    configured: false,
    contactsCreated: 0,
    contactsUpdated: 0,
    dealsCreated: 0,
    dealsUpdated: 0,
    errors: 0,
  };
  let organizationsWithConnection = 0;

  // Hoje só existe UMA organização candidata (o próprio dono do produto usando
  // o CRM para vender o próprio SaaS). Buscar por slug em vez de listar toda
  // `billing_export_connections` evita varrer organizações de clientes que um
  // dia conectarem a própria fonte de billing por engano de outra rota — a
  // sincronização com o CRM é uma feature explicitamente ligada por org, não
  // um efeito colateral automático de conectar o dashboard.
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", "periciaia")
    .maybeSingle();
  if (!org) return { organizationsWithConnection: 0, totals };

  const orgId = (org as { id: string }).id;
  const result = await syncBillingToCrm(orgId);
  if (!result.configured) return { organizationsWithConnection: 0, totals };

  organizationsWithConnection = 1;
  totals.configured = true;
  totals.contactsCreated += result.contactsCreated;
  totals.contactsUpdated += result.contactsUpdated;
  totals.dealsCreated += result.dealsCreated;
  totals.dealsUpdated += result.dealsUpdated;
  totals.errors += result.errors;

  const houveEfeito =
    totals.contactsCreated + totals.contactsUpdated + totals.dealsCreated + totals.dealsUpdated > 0;
  if (houveEfeito) {
    await audit({
      action: "billing_export.crm_synced",
      organizationId: orgId,
      resourceType: "crm_leads",
      metadata: { ...totals, requestId },
      requestId,
    });
  } else if (totals.errors > 0) {
    logger.error("[periciaia-billing-sync] rodada com erros e zero efeito", {
      errors: totals.errors,
      requestId,
    });
  }

  return { organizationsWithConnection, totals };
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  try {
    const result = await runPericiaiaBillingSync(createAdminClient(), requestId);
    return ok(result, { requestId });
  } catch (error) {
    logger.error("[periciaia-billing-sync] falhou", {
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    return fail("internal_error", "Sincronização de billing falhou.", 500, { requestId });
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
