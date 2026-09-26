import { describe, it, expect } from "vitest";
import { stripeBillingFixture, otherBillingFixture } from "@/tests/fixtures/billing-export";
import {
  normalizeOther,
  normalizeStripe,
  otherExportSchema,
  stripeExportSchema,
} from "./contracts";

describe("contratos de cobrança", () => {
  it("converte v1 de reais para centavos sem multiplicar v2 novamente", () => {
    expect(normalizeStripe(stripeExportSchema.parse(stripeBillingFixture)).mrr_cents).toBe(14990);
    expect(normalizeOther(otherExportSchema.parse(otherBillingFixture)).mrr_cents).toBe(9990);
  });
  it("não confunde assinaturas Stripe com clientes únicos", () => {
    expect(normalizeStripe(stripeBillingFixture).active_subscriptions).toBe(2);
    expect(normalizeOther(otherBillingFixture).active_customers).toBe(1);
    expect(normalizeStripe(stripeBillingFixture)).not.toHaveProperty("customer_count");
  });
  it("não considera moedas diferentes como BRL", () => {
    const other = structuredClone(otherBillingFixture);
    other.subscriptions[0]!.currency = "usd";
    expect(normalizeOther(other).mrr_cents).toBeNull();
    expect(normalizeOther(other).subscriptions[0]?.currency).toBe("USD");
  });
  it("não soma ou replica registros repetidos; separa identidades por provedor", () => {
    const data = otherExportSchema.parse(otherBillingFixture);
    data.customers.push({ ...data.customers[0]!, provider: "abacatepay", name: "Outro cliente" });
    data.subscriptions.push({ ...data.subscriptions[0]!, provider: "abacatepay" });
    data.subscriptions.push(data.subscriptions[0]!);
    const normalized = normalizeOther(data);
    expect(normalized.customer_count).toBe(2);
    expect(normalized.subscriptions).toHaveLength(2);
    expect(normalized.subscriptions.map((s) => s.name)).toEqual([
      "Cliente sintético PIX",
      "Outro cliente",
    ]);
  });
  it("recusa moeda inválida e Stripe dentro da exportação v2", () => {
    expect(
      otherExportSchema.safeParse({
        ...otherBillingFixture,
        subscriptions: [{ ...otherBillingFixture.subscriptions[0], currency: "dinheiro" }],
      }).success,
    ).toBe(false);
    expect(
      otherExportSchema.safeParse({
        ...otherBillingFixture,
        customers: [{ ...otherBillingFixture.customers[0], provider: "stripe" }],
      }).success,
    ).toBe(false);
    for (const currency of ["JPY", "KWD", "USD"]) {
      expect(
        otherExportSchema.safeParse({
          ...otherBillingFixture,
          subscriptions: [{ ...otherBillingFixture.subscriptions[0], currency }],
        }).success,
      ).toBe(false);
    }
  });
  it("preserva valor devido e vencimento de cobrança não paga", () => {
    const data = structuredClone(otherBillingFixture);
    data.payments[0]!.status = "overdue";
    data.payments[0]!.amountPaidMinor = 0;
    const normalized = normalizeOther(otherExportSchema.parse(data));
    expect(normalized.payments[0]).toMatchObject({
      amount_due_cents: 9990,
      amount_cents: 0,
      status: "overdue",
    });
  });
  it("remove telefone, URL de fatura e campos extras da resposta ao navegador", () => {
    const data = stripeExportSchema.parse({
      ...stripeBillingFixture,
      recentPayments: [
        { ...stripeBillingFixture.recentPayments[0], invoiceUrl: "https://example.test/private" },
      ],
    });
    expect(JSON.stringify(normalizeStripe(data))).not.toContain("private");
    const other = otherExportSchema.parse({
      ...otherBillingFixture,
      customers: [{ ...otherBillingFixture.customers[0], phone: "segredo" }],
    });
    expect(JSON.stringify(normalizeOther(other))).not.toContain("segredo");
  });
  it("sem dados não inventa MRR igual a zero", () => {
    expect(
      normalizeOther({ ...otherBillingFixture, customers: [], subscriptions: [], payments: [] })
        .mrr_cents,
    ).toBeNull();
  });
});
