import { describe, expect, it } from "vitest";
import { classifyMrrChange } from "@/lib/saas/revenue";
import { classifyHealth } from "@/lib/saas/customer360";
import { revenueObservationSchema } from "@/lib/schemas/product-events";

describe("Gravity CRM SaaS core", () => {
  it("classifica movimentos de MRR sem transformar cancelamento em valor positivo", () => {
    const base = {
      external_event_id: "evt_2",
      source: "app",
      external_subscription_id: "sub_1",
      external_customer_id: "cus_1",
      status: "active" as const,
      mrr_cents: 15000,
      observed_at: "2026-10-07T12:00:00-03:00",
    };
    expect(classifyMrrChange({ status: "active", mrr_cents: 10000, last_observed_at: "" }, base))
      .toMatchObject({ type: "expansion", delta: 5000 });
    expect(classifyMrrChange({ status: "active", mrr_cents: 15000, last_observed_at: "" }, { ...base, status: "canceled", mrr_cents: 0 }))
      .toMatchObject({ type: "churn", delta: -15000 });
  });

  it("aceita baseline explícito para migração sem inventar novo MRR", () => {
    const parsed = revenueObservationSchema.parse({
      external_event_id: "evt_import_1",
      source: "periciaia",
      external_subscription_id: "sub_old",
      external_customer_id: "cus_old",
      status: "active",
      mrr_cents: 29700,
      observed_at: "2026-10-07T12:00:00-03:00",
      baseline: true,
    });
    expect(parsed.baseline).toBe(true);
  });

  it("não aceita PII livre nas propriedades de telemetria", () => {
    const parsed = revenueObservationSchema.safeParse({
      external_event_id: "x",
      source: "app",
      external_subscription_id: "s",
      external_customer_id: "c",
      status: "active",
      mrr_cents: 0,
      observed_at: "2026-10-07T12:00:00-03:00",
    });
    expect(parsed.success).toBe(true);
  });

  it("score de saúde é explicável e distingue falta de dado de risco real", () => {
    expect(classifyHealth({ status: "active", lastUseAt: null, totalEvents: 0 }).band)
      .toBe("insufficient_data");
    expect(classifyHealth({ status: "past_due", lastUseAt: null, totalEvents: 0 }).band)
      .toBe("critical");
  });
});
