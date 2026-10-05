import "server-only";

import type { AbacatePayCheckout, AbacatePayCustomer } from "./client";
import type { OtherExport } from "@/lib/billing-export/contracts";

/**
 * Transforma clientes + checkouts CRUS da AbacatePay no contrato `OtherExport`
 * já usado por `lib/billing-export` (Stripe/manual) — é o mesmo formato que
 * `evidencesFromOther`/`normalizeOther` já sabem classificar, então esta é a
 * ÚNICA peça nova: todo o resto (destino no funil, merge com contato
 * existente, dashboard) é reaproveitado sem duplicar regra.
 *
 * ─── Por que "assinatura" é CALCULADA, não lida direto ──────────────────────
 *
 * A AbacatePay aqui não tem objeto de assinatura: cada cobrança é um checkout
 * `ONE_TIME` próprio (confirmado contra a API real desta conta — todo
 * `frequency` é `ONE_TIME`, `nextChargeAt` sempre nulo). O que existe é
 * `metadata.billingPeriod` (anual/semestral/trimestral/mensal) no checkout. A
 * "assinatura" de um cliente é inferida do checkout PAGO mais recente: período
 * = `billingPeriod`, fim do período = quando foi pago + esse período. Dentro
 * do período → ativo; vencido → `past_due`. Sem nenhum checkout pago (só
 * reembolsado/cancelado/expirado) → cancelado.
 *
 * Cliente cujo único rastro é um checkout `PENDING` (ainda tentando pagar)
 * NÃO vira assinatura aqui — ele não tem histórico de cobrança concluída, e
 * `evidencesFromOther` exige `subscriptions`. Ele entra no `payments` (para o
 * dashboard mostrar "em aberto"), mas não move card de lead sozinho. Ver
 * `docs/` futuro se este CRM quiser tratar checkout pendente como sinal de
 * lead quente — fora do escopo desta sessão.
 */

const MESES_POR_PERIODO: Record<string, number> = {
  mensal: 1,
  bimestral: 2,
  trimestral: 3,
  semestral: 6,
  anual: 12,
};

function mesesDoPeriodo(billingPeriod: string | undefined | null): number {
  if (!billingPeriod) return 12; // desconhecido: assume o período mais longo (conservador — evita marcar "vencido" cedo demais).
  return MESES_POR_PERIODO[billingPeriod.toLowerCase()] ?? 12;
}

function paidAt(checkout: AbacatePayCheckout): string {
  return checkout.updatedAt ?? checkout.createdAt;
}

export function buildAbacatePayExport(
  customers: AbacatePayCustomer[],
  checkouts: AbacatePayCheckout[],
): OtherExport {
  const agora = new Date();
  const porCliente = new Map<string, AbacatePayCheckout[]>();
  for (const checkout of checkouts) {
    if (!checkout.customerId) continue;
    const lista = porCliente.get(checkout.customerId) ?? [];
    lista.push(checkout);
    porCliente.set(checkout.customerId, lista);
  }

  const subscriptions: OtherExport["subscriptions"] = [];
  let activeCustomers = 0;
  let delinquentCustomers = 0;
  let activeMrrMinor = 0;
  let mrrAtRiskMinor = 0;

  for (const [customerId, lista] of porCliente) {
    const ordenada = [...lista].sort(
      (a, b) => new Date(paidAt(b)).getTime() - new Date(paidAt(a)).getTime(),
    );
    const ultimaPaga = ordenada.find((c) => c.status === "PAID");

    let status: "active" | "past_due" | "canceled";
    let currentPeriodEnd: string | null = null;
    let billingPeriod = "anual";

    if (ultimaPaga) {
      billingPeriod = String(ultimaPaga.metadata?.billingPeriod ?? "anual");
      const meses = mesesDoPeriodo(billingPeriod);
      const fim = new Date(paidAt(ultimaPaga));
      fim.setMonth(fim.getMonth() + meses);
      currentPeriodEnd = fim.toISOString();
      status = fim.getTime() >= agora.getTime() ? "active" : "past_due";
    } else {
      status = "canceled";
    }

    const amountMinor = ultimaPaga?.paidAmount ?? ultimaPaga?.amount ?? ordenada[0]?.amount ?? 0;
    const mrrMinor = status === "active" ? Math.round(amountMinor / mesesDoPeriodo(billingPeriod)) : 0;

    if (status === "active") {
      activeCustomers++;
      activeMrrMinor += mrrMinor;
    } else if (status === "past_due") {
      delinquentCustomers++;
      mrrAtRiskMinor += Math.round(amountMinor / mesesDoPeriodo(billingPeriod));
    } else {
      delinquentCustomers++;
    }

    subscriptions.push({
      provider: "abacatepay",
      externalId: ultimaPaga?.id ?? ordenada[0]?.id ?? customerId,
      customerExternalId: customerId,
      status,
      billingMode: "checkout",
      amountMinor,
      currency: "brl",
      billingInterval: "month",
      intervalCount: mesesDoPeriodo(billingPeriod),
      mrrMinor,
      currentPeriodEnd,
    });
  }

  return {
    version: 2,
    generatedAt: agora.toISOString(),
    source: "abacatepay-direta",
    summary: { activeCustomers, delinquentCustomers, activeMrrMinor, mrrAtRiskMinor },
    customers: customers.map((c) => ({
      provider: "abacatepay",
      externalId: c.id,
      name: c.name,
      email: c.email,
      phone: c.cellphone ?? null,
      // A AbacatePay não devolve `createdAt` no cliente (confirmado contra a
      // API real). O contrato exige o campo, mas nada em `evidencesFromOther`/
      // `normalizeOther` o lê para decidir nada — só existe aqui pra satisfazer
      // o schema. `agora` em vez de inventar uma data no passado.
      createdAt: agora.toISOString(),
    })),
    subscriptions,
    payments: checkouts.map((c) => ({
      provider: "abacatepay",
      externalId: c.id,
      customerExternalId: c.customerId ?? "sem-cliente",
      subscriptionExternalId: null,
      status: c.status.toLowerCase(),
      amountDueMinor: c.amount,
      amountPaidMinor: c.paidAmount ?? (c.status === "PAID" ? c.amount : 0),
      currency: "brl",
      paidAt: c.status === "PAID" ? paidAt(c) : null,
      dueAt: c.dueDate ?? null,
      createdAt: c.createdAt,
    })),
  };
}
