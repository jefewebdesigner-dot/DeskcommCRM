import { describe, expect, it } from "vitest";
import {
  CANCEL_OFFER_META,
  recommendedOfferForReason,
  summarizeCancelFlow,
} from "@/lib/saas/cancel-flow";
import { playbookForChurnReason } from "@/lib/saas/retention";

describe("Gravity CRM Retention", () => {
  it("recomenda intervenção coerente com o motivo sem impedir cancelamento", () => {
    expect(recommendedOfferForReason("price")).toBe("downgrade");
    expect(recommendedOfferForReason("delinquency")).toBe("payment_recovery");
    expect(recommendedOfferForReason("business_closed")).toBe("none");
    expect(CANCEL_OFFER_META.none.label).toBe("Sem oferta");
  });

  it("não cria playbook de reativação para empresa encerrada", () => {
    expect(playbookForChurnReason("business_closed").createsAction).toBe(false);
    expect(playbookForChurnReason("technical_issue").priority).toBe("critical");
  });

  it("mede somente MRR preservado confirmado em sessões salvas", () => {
    const metrics=summarizeCancelFlow([
      {
        id:"1",account_id:"a",status:"saved",reason:"price",
        recommended_offer_type:"downgrade",accepted_offer_type:"downgrade",
        opening_mrr_cents:30000,preserved_mrr_cents:20000,
        offer_presented_at:"2026-10-07T10:00:00-03:00",resolved_at:"2026-10-07T10:05:00-03:00",
      },
      {
        id:"2",account_id:"b",status:"cancelled",reason:"other",
        recommended_offer_type:"human_review",accepted_offer_type:null,
        opening_mrr_cents:10000,preserved_mrr_cents:0,
        offer_presented_at:null,resolved_at:"2026-10-07T11:00:00-03:00",
      },
    ]);
    expect(metrics.sessions).toBe(2);
    expect(metrics.savedCustomers).toBe(1);
    expect(metrics.cancelledCustomers).toBe(1);
    expect(metrics.saveRate).toBe(0.5);
    expect(metrics.preservedMrrCents).toBe(20000);
  });
});
