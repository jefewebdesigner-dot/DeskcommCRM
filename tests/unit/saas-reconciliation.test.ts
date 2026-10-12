import { describe, expect, it } from "vitest";

import { classifyRevenuePopulation } from "@/lib/saas/reconciliation";

describe("classifyRevenuePopulation", () => {
  const stages = [
    { id: "new", name: "Novo Lead", isWon: false, isLost: false },
    { id: "won", name: "Convertido", isWon: true, isLost: false },
    { id: "lost", name: "Perdido", isWon: false, isLost: true },
  ];

  it("não conta cliente atual como lead comercial", () => {
    const result = classifyRevenuePopulation({
      stages,
      leads: [
        { id: "l1", contactId: "c1", stageId: "new", status: "open", source: "whatsapp" },
        { id: "l2", contactId: "c2", stageId: "new", status: "open", source: "whatsapp" },
      ],
      accounts: [{ id: "a1", contactId: "c1" }],
      subscriptions: [{ accountId: "a1", status: "active", source: "stripe" }],
    });

    expect(result.counts.activeCustomers).toBe(1);
    expect(result.counts.validLeads).toBe(1);
    expect(result.quality.activeCustomersInOpenFunnel).toBe(1);
  });

  it("mantém inadimplentes separados dos ativos", () => {
    const result = classifyRevenuePopulation({
      stages,
      leads: [],
      accounts: [
        { id: "active", contactId: "c1" },
        { id: "past", contactId: "c2" },
      ],
      subscriptions: [
        { accountId: "active", status: "active", source: "stripe" },
        { accountId: "past", status: "active", source: "stripe" },
        { accountId: "past", status: "past_due", source: "abacatepay" },
      ],
    });

    expect(result.counts.activeCustomers).toBe(1);
    expect(result.counts.delinquentCustomers).toBe(1);
  });

  it("trata ganho sem assinatura atual como confirmação pendente", () => {
    const result = classifyRevenuePopulation({
      stages,
      leads: [{ id: "l1", contactId: "c1", stageId: "won", status: "won", source: "whatsapp" }],
      accounts: [],
      subscriptions: [],
    });

    expect(result.counts.pendingPayment).toBe(1);
    expect(result.counts.activeCustomers).toBe(0);
  });

  it("exclui espelhos financeiros da contagem de leads válidos", () => {
    const result = classifyRevenuePopulation({
      stages,
      leads: [
        { id: "l1", contactId: "c1", stageId: "new", status: "open", source: "peritoia-backfill" },
        { id: "l2", contactId: "c2", stageId: "new", status: "open", source: "whatsapp" },
      ],
      accounts: [],
      subscriptions: [],
    });

    expect(result.counts.validLeads).toBe(1);
    expect(result.quality.legacyBackfill).toBe(1);
  });
});

describe("lerTudo (leitura paginada)", () => {
  it("junta todas as páginas e para na página incompleta — sem cortar em 1000", async () => {
    const { lerTudo } = await import("@/lib/saas/reconciliation");
    const total = 2345;
    const pedidos: Array<[number, number]> = [];
    const r = await lerTudo(async (de, ate) => {
      pedidos.push([de, ate]);
      const fim = Math.min(ate, total - 1);
      return { data: Array.from({ length: Math.max(0, fim - de + 1) }, (_, i) => de + i), error: null };
    });
    expect(r.error).toBeNull();
    expect(r.data).toHaveLength(total);
    expect(pedidos).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("devolve o erro da página que falhou", async () => {
    const { lerTudo } = await import("@/lib/saas/reconciliation");
    const r = await lerTudo(async () => ({ data: null, error: new Error("quota") }));
    expect(String(r.error)).toContain("quota");
  });
});
