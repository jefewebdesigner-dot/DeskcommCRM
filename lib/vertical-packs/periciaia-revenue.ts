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
    .select("source,baseline_completed_at")
    .eq("organization_id", organizationId);
  if (baselineRows.error) throw baselineRows.error;

  const completedSources = new Set(
    (baselineRows.data ?? [])
      .filter((row) => Boolean(row.baseline_completed_at))
      .map((row) => String(row.source)),
  );
  const observedAt = new Date().toISOString();
  const seenSources = new Set<string>();
  const blockedSources = new Set<string>();

  let observed = 0;
  let skipped = 0;
  let failures = 0;

  for (const entity of entities) {
    for (const subscription of entity.subscriptions) {
      const source = sourceForProvider(subscription.provider);
      if (!source) {
        skipped++;
        continue;
      }
      seenSources.add(source);

      if (!subscription.customerId || !subscription.subscriptionId) {
        skipped++;
        blockedSources.add(source);
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
              subscription.mrrCents +
              ":" +
              observedAt,
            source,
            external_subscription_id: subscription.subscriptionId,
            external_customer_id: subscription.customerId,
            customer_name: entity.name ?? undefined,
            status,
            mrr_cents: status === "canceled" ? 0 : subscription.mrrCents,
            observed_at: observedAt,
            baseline: !completedSources.has(source),
          },
          { deferSnapshot: true, requireExistingIdentity: true },
        );
        observed++;
      } catch (error) {
        failures++;
        blockedSources.add(source);
        console.error("[periciaia-revenue] observation failed", {
          source,
          subscriptionId: subscription.subscriptionId,
          error,
        });
      }
    }
  }

  const completedNow: string[] = [];
  for (const source of seenSources) {
    if (completedSources.has(source) || blockedSources.has(source)) continue;

    const completed = await admin
      .from("revenue_source_baselines")
      .update({ baseline_completed_at: observedAt })
      .eq("organization_id", organizationId)
      .eq("source", source)
      .is("baseline_completed_at", null);
    if (completed.error) {
      failures++;
      blockedSources.add(source);
      console.error("[periciaia-revenue] baseline completion failed", {
        source,
        error: completed.error,
      });
      continue;
    }
    completedNow.push(source);
  }

  if (observed > 0) {
    await refreshRevenueSnapshot(organizationId);
    await syncCustomerActionCenter(organizationId);
  }

  if (failures > 0) {
    throw new Error(
      "periciaia_revenue_sync_incomplete:" +
        [...blockedSources].sort().join(","),
    );
  }

  return {
    observed,
    skipped,
    failures,
    completedNow,
    incompleteSources: [...blockedSources].sort(),
  };
}
