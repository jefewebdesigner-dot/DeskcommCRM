import "server-only";

import type { LegacyImportEntity } from "@/lib/billing-export/legacy-import";
import { syncCustomerActionCenter } from "@/lib/saas/actions";
import {
  ingestRevenueObservation,
  refreshRevenueSnapshot,
} from "@/lib/saas/revenue";
import { createAdminClient } from "@/lib/supabase/admin";
import { PERICIAIA_ORGANIZATION_ID } from "@/lib/vertical-packs/periciaia-customer360";

function sourceForProvider(provider: string) {
  return provider
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

export async function syncPericiaiaRevenueToCore(
  entities: LegacyImportEntity[],
  organizationId = PERICIAIA_ORGANIZATION_ID,
) {
  if (organizationId !== PERICIAIA_ORGANIZATION_ID) {
    throw new Error("A receita da PeríciaIA deve permanecer na organização existente.");
  }

  const admin = createAdminClient();
  const baselineRows = await admin
    .from("revenue_source_baselines")
    .select("source")
    .eq("organization_id", organizationId);
  if (baselineRows.error) throw baselineRows.error;

  const existingSources = new Set(
    (baselineRows.data ?? []).map((row) => String(row.source)),
  );
  const observedAt = new Date().toISOString();

  let observed = 0;
  let skipped = 0;
  let failures = 0;

  for (const entity of entities) {
    for (const subscription of entity.subscriptions) {
      if (!subscription.customerId || !subscription.subscriptionId) {
        skipped++;
        continue;
      }

      const source = sourceForProvider(subscription.provider);
      if (!source) {
        skipped++;
        continue;
      }

      const status =
        subscription.status === "active"
          ? subscription.cancelAtPeriodEnd
            ? "canceling"
            : "active"
          : subscription.status === "past_due"
            ? "past_due"
            : "canceled";

      try {
        await ingestRevenueObservation(
          organizationId,
          {
            external_event_id:
              "periciaia-sync:" +
              subscription.subscriptionId +
              ":" +
              status +
              ":" +
              subscription.mrrCents,
            source,
            external_subscription_id: subscription.subscriptionId,
            external_customer_id: subscription.customerId,
            customer_name: entity.name ?? undefined,
            status,
            mrr_cents: status === "canceled" ? 0 : subscription.mrrCents,
            observed_at: observedAt,
            baseline: !existingSources.has(source),
          },
          { deferSnapshot: true, requireExistingIdentity: true },
        );
        observed++;
      } catch (error) {
        failures++;
        console.error("[periciaia-revenue] observation failed", {
          source,
          subscriptionId: subscription.subscriptionId,
          error,
        });
      }
    }
  }

  if (observed > 0) {
    await refreshRevenueSnapshot(organizationId);
    await syncCustomerActionCenter(organizationId);
  }

  return { observed, skipped, failures };
}
