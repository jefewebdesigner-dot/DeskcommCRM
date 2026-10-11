import { describe, expect, it } from "vitest";
import { canUseRevenueBaseline, classifyMrrChange } from "@/lib/saas/revenue";
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

  it("baseline histórico exige escopo separado da escrita normal", () => {
    expect(canUseRevenueBaseline(["saas_revenue:write"])).toBe(false);
    expect(
      canUseRevenueBaseline(["saas_revenue:write", "saas_revenue:baseline"]),
    ).toBe(true);
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

describe("resumo de receita para o portfólio", () => {
  it("soma só assinaturas recorrentes e conta cada cliente uma vez", async () => {
    const { summarizeRevenue } = await import("@/lib/saas/revenue");
    const r = summarizeRevenue([
      { status: "active", mrr_cents: 9990, account_id: "a" },
      { status: "active", mrr_cents: 4990, account_id: "a" },
      { status: "past_due", mrr_cents: "9990", account_id: "b" },
      { status: "canceling", mrr_cents: 9990, account_id: "c" },
      { status: "canceled", mrr_cents: 9990, account_id: "d" },
      { status: "estranho", mrr_cents: 100, account_id: "e" },
    ], null);
    expect(r.mrr_cents).toBe(34960);
    expect(r.active_customers).toBe(3);
    expect(r.subscriptions).toEqual({ active: 2, past_due: 1, canceling: 1, canceled: 1, unknown: 1 });
    expect(r.month).toBeNull();
  });

  it("traz o movimento do mês sem inventar abertura quando o histórico é incompleto", async () => {
    const { summarizeRevenue } = await import("@/lib/saas/revenue");
    const r = summarizeRevenue([], {
      month: "2026-10-01", opening_mrr_cents: null, new_mrr_cents: 2990, expansion_mrr_cents: null,
      reactivation_mrr_cents: 0, contraction_mrr_cents: 0, churn_mrr_cents: 990, closing_mrr_cents: 0,
      active_customers: 0, churned_customers: 1, nrr_rate: null, grr_rate: "0.95", history_complete: false, calculated_at: "2026-10-11T09:13:00Z",
    });
    expect(r.month).toMatchObject({ opening_mrr_cents: null, new_mrr_cents: 2990, expansion_mrr_cents: 0, churn_mrr_cents: 990, grr_rate: 0.95, history_complete: false });
  });
});
