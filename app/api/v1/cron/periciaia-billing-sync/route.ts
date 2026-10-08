/**
 * GET /api/v1/cron/periciaia-billing-sync
 *
 * Puxa a fonte de billing conectada (Stripe + PIX/manual, ver
 * lib/billing-export/) e mantém contato + posição no funil de cada pessoa com
 * assinatura: ativo → Pós-vendas, vencido/cancelado → Retenção (nunca Vendas).
 * O estado financeiro (todas as assinaturas) fica no contato.
 *
 * Roda para a organização PeríciaIA (id fixo — ver comentário em
 * `runPericiaiaBillingSync`), a única com conexão de billing salva
 * (`billing_export_connections`). Sem conexão configurada, sai em silêncio —
 * não é erro, é "não configurado".
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
import { syncBillingToCrmWithSnapshot, type SyncResult } from "@/lib/billing-export/crm-sync";
import { reconcilePericiaiaCustomer360 } from "@/lib/vertical-packs/periciaia-customer360";
import { syncPericiaiaRevenueToCore } from "@/lib/vertical-packs/periciaia-revenue";

export const dynamic = "force-dynamic";

interface RunResult {
  organizationsWithConnection: number;
  totals: SyncResult;
  customer360: {
    scanned: number;
    eligible: number;
    accountsCreated: number;
    accountsReused: number;
    identitiesLinked: number;
  } | null;
  revenueCore: {
    observed: number;
    skipped: number;
    failures: number;
  } | null;
}

export async function runPericiaiaBillingSync(requestId: string): Promise<RunResult> {
  const totals: SyncResult = {
    configured: false,
    contactsCreated: 0,
    contactsUpdated: 0,
    dealsCreated: 0,
    dealsUpdated: 0,
    dealsMoved: 0,
    conflicts: 0,
    errors: 0,
    sampleErrors: [],
  };
  let organizationsWithConnection = 0;

  // Hoje só existe UMA organização candidata (o próprio dono do produto usando
  // o CRM para vender o próprio SaaS) — id fixo, não resolvido por slug.
  //
  // ⚠️ Isto não é preguiça: `organizations` tem RLS restrita a
  // `fn_user_org_ids()`/`fn_is_platform_admin()`, e a identidade de serviço
  // (o que `createAdminClient()` de fato é neste projeto Neon — não um
  // bypass real de RLS, ver `lib/supabase/admin.ts`) não é membro de nenhuma
  // organização nem platform_admin. `admin.from("organizations").select(...)`
  // aqui sempre volta vazio, silenciosamente — medido, não hipótese. Resolver
  // por slug pareceria funcionar em teste manual (erro nunca aparece) e falhar
  // sempre em produção. `billing_export_connections` tem o mesmo problema pela
  // outra ponta: RLS ali exige `app.billing_export_org` já setado (config.ts),
  // então também não dá para descobrir organizações por ali sem já saber o id.
  // Contornar isso de verdade (ex.: dar à identidade de serviço uma política
  // própria de leitura em `organizations`) é mudança maior, fora do escopo
  // desta feature — sinalizado para quem revisar depois.
  const orgId = "9563e071-406b-4db2-aaa4-d08846d3267b";
  const snapshot = await syncBillingToCrmWithSnapshot(orgId);
  const result = snapshot.result;
  if (!result.configured) {
    return {
      organizationsWithConnection: 0,
      totals,
      customer360: null,
      revenueCore: null,
    };
  }

  organizationsWithConnection = 1;
  totals.configured = true;
  totals.contactsCreated += result.contactsCreated;
  totals.contactsUpdated += result.contactsUpdated;
  totals.dealsCreated += result.dealsCreated;
  totals.dealsUpdated += result.dealsUpdated;
  totals.dealsMoved += result.dealsMoved;
  totals.conflicts += result.conflicts;
  totals.errors += result.errors;
  totals.sampleErrors.push(...result.sampleErrors);

  // A mesma rodada que atualiza os contatos também os transforma em contas
  // SaaS do Customer 360. Não cria segundo contato nem segundo tenant.
  const customer360 = await reconcilePericiaiaCustomer360(orgId);

  // O mesmo snapshot vivo que move os contatos/funis alimenta o Revenue OS.
  // Nenhuma segunda chamada ao provedor e nenhuma segunda fonte de verdade.
  const revenueCore = await syncPericiaiaRevenueToCore(snapshot.entities, orgId);

  const houveEfeito =
    totals.contactsCreated + totals.contactsUpdated + totals.dealsCreated + totals.dealsUpdated + totals.dealsMoved > 0;
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

  return { organizationsWithConnection, totals, customer360, revenueCore };
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
    const result = await runPericiaiaBillingSync(requestId);
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
