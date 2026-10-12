import { describe, expect, it } from "vitest";
import { filtrarClientes, montarFicha, resumoDaBase, emRisco } from "@/lib/saas/customer360-detail";
import type { SaaSCustomer } from "@/lib/saas/customer360";

const c = (o: Partial<SaaSCustomer>): SaaSCustomer => ({
  id: "id-" + (o.name ?? "x"), name: "Cliente", contactId: null, sources: ["periciaia"], status: "active",
  mrrCents: 0, mrrAtRiskCents: 0, lastUseAt: null, totalEvents: 0, healthScore: null, healthBand: "insufficient_data",
  evidence: [], nextAction: null, ...o,
});

const base = [
  c({ name: "Clínica Sorriso", mrrCents: 9990, contactId: "k1", healthBand: "healthy" }),
  c({ name: "José Perícias", status: "past_due", mrrCents: 29700, mrrAtRiskCents: 29700, healthBand: "critical" }),
  c({ name: "Ana Advocacia", status: "canceling", mrrCents: 9990, mrrAtRiskCents: 9990, healthBand: "high_risk", sources: ["abacatepay"] }),
  c({ name: "Antigo", status: "churned" }),
];

describe("Customer 360 — lista e resumo", () => {
  it("filtra por situação e pelo atalho 'em risco'", () => {
    expect(filtrarClientes(base, { status: "past_due" }).map((x) => x.name)).toEqual(["José Perícias"]);
    expect(filtrarClientes(base, { status: "em_risco" }).map((x) => x.name)).toEqual(["José Perícias", "Ana Advocacia"]);
    expect(filtrarClientes(base, { status: "qualquer-coisa" })).toHaveLength(4);
  });

  it("busca sem acento e também pela fonte", () => {
    expect(filtrarClientes(base, { q: "clinica" }).map((x) => x.name)).toEqual(["Clínica Sorriso"]);
    expect(filtrarClientes(base, { q: "abacate" }).map((x) => x.name)).toEqual(["Ana Advocacia"]);
  });

  it("resume a base: pagantes, MRR, risco e quem não tem contato vinculado", () => {
    expect(resumoDaBase(base)).toEqual({ clientes: 3, mrrCents: 49680, emRisco: 2, mrrEmRiscoCents: 39690, semContato: 3 });
    expect(emRisco(base[0]!)).toBe(false);
  });
});

describe("Customer 360 — ficha", () => {
  it("ordena assinaturas vivas primeiro, movimentos do mais recente e ações pela prioridade", () => {
    const f = montarFicha({
      subs: [
        { id: "s1", source: "periciaia", status: "canceled", mrr_cents: 0, last_observed_at: "2026-09-01" },
        { id: "s2", source: "periciaia", status: "active", mrr_cents: 9990, started_at: "2026-01-10", last_observed_at: "2026-10-01" },
      ],
      eventos: [
        { id: "e1", event_type: "new", effective_at: "2026-01-10T00:00:00Z", delta_cents: 9990, current_mrr_cents: 9990 },
        { id: "e2", event_type: "churn", effective_at: "2026-09-01T00:00:00Z", delta_cents: -9990, current_mrr_cents: 0 },
        { id: "e3", event_type: "estranho", effective_at: "2026-09-02T00:00:00Z", delta_cents: 1, current_mrr_cents: 1 },
      ],
      acoes: [
        { id: "a1", title: "Ligar", priority: "medium", status: "open", revenue_impact_cents: 100 },
        { id: "a2", title: "Recuperar pagamento", priority: "critical", status: "open", revenue_impact_cents: 9990 },
        { id: "a3", title: "Feita", priority: "critical", status: "done" },
      ],
      ids: [{ source: "periciaia", external_customer_id: "cus_1" }],
    });
    expect(f.assinaturas.map((s) => s.id)).toEqual(["s2", "s1"]);
    expect(f.movimentos.map((m) => m.id)).toEqual(["e2", "e1"]);
    expect(f.acoes.map((a) => a.titulo)).toEqual(["Recuperar pagamento", "Ligar"]);
    expect(f.fontes).toEqual([{ fonte: "periciaia", externo: "cus_1" }]);
  });
});
