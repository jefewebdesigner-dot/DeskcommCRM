import { z } from "zod";

const count = z.number().int().nonnegative();
const money = z.number().finite();
const timestamp = z.iso.datetime({ offset: true });
const label = z.string().max(320);
const person = { name: label.nullish(), email: label.nullish() };

/** Contrato externo: v1 usa reais; v2 usa unidades menores (centavos em BRL). */
export const stripeExportSchema = z.object({
  generatedAt: timestamp,
  summary: z.object({
    mrr: money.nonnegative(),
    arr: money.nonnegative(),
    activeCount: count,
    pastDueCount: count,
    churnedTotal: count,
    churnedLast90d: count,
    churnRate90d: z.number().min(0).max(100),
    totalEverRevenue: money,
    arpu: money,
    cancelingCount: count,
    planBreakdown: z.record(label, z.object({ count, mrr: money })),
  }),
  monthlyData: z
    .array(z.object({ month: label, revenue: money, newSubs: count, churnedSubs: count }))
    .max(120),
  upcomingRenewals: z
    .array(z.object({ ...person, renewsAt: timestamp, cancelAtPeriodEnd: z.boolean() }))
    .max(50000),
  recentPayments: z.array(z.object({ ...person, amount: money, date: timestamp })).max(50000),
  pastDueCustomers: z.array(z.object(person)).max(50000),
});

const identity = { provider: z.enum(["abacatepay", "manual"]), externalId: label.min(1) };
export const otherExportSchema = z.object({
  version: z.literal(2),
  generatedAt: timestamp,
  source: label,
  summary: z.object({
    activeCustomers: count,
    delinquentCustomers: count,
    activeMrrMinor: count,
    mrrAtRiskMinor: count,
  }),
  customers: z
    .array(z.object({ ...identity, ...person, phone: label.nullish(), createdAt: timestamp }))
    .max(50000),
  subscriptions: z
    .array(
      z.object({
        ...identity,
        customerExternalId: label.min(1),
        status: label,
        billingMode: label,
        amountMinor: count,
        currency: z.string().regex(/^brl$/i),
        billingInterval: label,
        intervalCount: count.positive(),
        mrrMinor: count,
        currentPeriodEnd: timestamp.nullable(),
      }),
    )
    .max(50000),
  payments: z
    .array(
      z.object({
        ...identity,
        customerExternalId: label.min(1),
        subscriptionExternalId: label.nullable(),
        status: label,
        amountDueMinor: count,
        amountPaidMinor: count,
        currency: z.string().regex(/^brl$/i),
        paidAt: timestamp.nullable(),
        dueAt: timestamp.nullable(),
        createdAt: timestamp,
      }),
    )
    .max(50000),
});

export type StripeExport = z.infer<typeof stripeExportSchema>;
export type OtherExport = z.infer<typeof otherExportSchema>;
export type BillingSourceError = "unauthorized" | "unavailable" | "invalid_data";
export type SourceResult<T> = { ok: true; data: T } | { ok: false; error: BillingSourceError };

const cents = (value: number) => Math.round(value * 100);

/** Fuso fixo do produto (PeríciaIA é 100% Brasil) — dia e mês na régua de Brasília. */
const BR_TZ = "America/Sao_Paulo";
const diaBR = (iso: string): string => new Intl.DateTimeFormat("en-CA", { timeZone: BR_TZ }).format(new Date(iso));
const mesBR = (iso: string): string => diaBR(iso).slice(0, 7);
const hojeBR = (): string => diaBR(new Date().toISOString());
const mesAtualBR = (): string => hojeBR().slice(0, 7);
const DIAS_30_MS = 30 * 24 * 60 * 60 * 1000;
const dentroDe30Dias = (iso: string): boolean => {
  const alvo = new Date(iso).getTime();
  const agora = Date.now();
  return alvo >= agora && alvo <= agora + DIAS_30_MS;
};

export function normalizeStripe(data: StripeExport) {
  // Amostra, não o total: `recentPayments` é um recorte (até 5 registros) que
  // a fonte manda pronto — não existe endpoint de "todos os pagamentos de
  // hoje". Filtrar por dia aqui só reduz uma amostra já pequena; por isso o
  // rótulo na tela diz "amostra" e nunca "vendas de hoje" sem qualificação.
  const hoje = hojeBR();
  const vendasHojeAmostra = data.recentPayments.filter((row) => diaBR(row.date) === hoje);
  // O mês atual É confiável: `monthlyData` é agregado pela própria fonte
  // (todo pagamento do mês, não uma amostra), e o produto sempre manda o mês
  // corrente como último item — mesma leitura que "30 fat. pagas em set/26"
  // no admin original.
  const mesAtual = data.monthlyData.at(-1) ?? null;
  const renovacoes30d = data.upcomingRenewals.filter((row) => dentroDe30Dias(row.renewsAt));

  return {
    generated_at: data.generatedAt,
    mrr_cents: cents(data.summary.mrr),
    arr_cents: cents(data.summary.arr),
    active_subscriptions: data.summary.activeCount,
    past_due_count: data.summary.pastDueCount,
    churn_rate_90d: data.summary.churnRate90d,
    churned_90d: data.summary.churnedLast90d,
    canceling_count: data.summary.cancelingCount,
    lifetime_revenue_cents: cents(data.summary.totalEverRevenue),
    plans: Object.entries(data.summary.planBreakdown).map(([name, value]) => ({
      name,
      count: value.count,
      mrr_cents: cents(value.mrr),
    })),
    monthly_revenue: data.monthlyData.map((row) => ({
      month: row.month,
      revenue_cents: cents(row.revenue),
    })),
    receita_mes_atual_cents: mesAtual ? cents(mesAtual.revenue) : null,
    receita_mes_atual_label: mesAtual?.month ?? null,
    vendas_hoje_amostra_count: vendasHojeAmostra.length,
    vendas_hoje_amostra_cents: vendasHojeAmostra.reduce((sum, row) => sum + cents(row.amount), 0),
    renovacoes_30d_count: renovacoes30d.length,
    renewals: data.upcomingRenewals.map((row) => ({
      name: row.name ?? null,
      email: row.email ?? null,
      renews_at: row.renewsAt,
      canceling: row.cancelAtPeriodEnd,
    })),
    payments: data.recentPayments.map((row) => ({
      name: row.name ?? null,
      email: row.email ?? null,
      amount_cents: cents(row.amount),
      paid_at: row.date,
    })),
    past_due: data.pastDueCustomers.map((row) => ({
      name: row.name ?? null,
      email: row.email ?? null,
    })),
  };
}

/** IDs são únicos dentro de cada provedor, nunca só pelo externalId. */
export function normalizeOther(data: OtherExport) {
  const key = (provider: string, id: string) => JSON.stringify([provider, id]);
  const customers = new Map(data.customers.map((row) => [key(row.provider, row.externalId), row]));
  const subscriptions = new Map(
    data.subscriptions.map((row) => [key(row.provider, row.externalId), row]),
  );
  const payments = new Map(data.payments.map((row) => [key(row.provider, row.externalId), row]));
  const personFor = (provider: string, id: string) => {
    const customer = customers.get(key(provider, id));
    return { name: customer?.name ?? null, email: customer?.email ?? null };
  };
  const currencies = new Set([...subscriptions.values()].map((row) => row.currency.toUpperCase()));

  // Esta fonte é EXAUSTIVA (até 50k pagamentos/assinaturas reais, não amostra
  // — diferente do Stripe), então dá para calcular "hoje" e "este mês" de
  // verdade, sem qualificar como aproximação.
  const hoje = hojeBR();
  const mesAtual = mesAtualBR();
  const pagosHoje = data.payments.filter((row) => row.status === "paid" && row.paidAt && diaBR(row.paidAt) === hoje);
  const pagosMes = data.payments.filter(
    (row) => row.status === "paid" && row.paidAt && mesBR(row.paidAt) === mesAtual,
  );
  const renovacoes30d = data.subscriptions.filter(
    (row) => row.status !== "canceled" && row.currentPeriodEnd && dentroDe30Dias(row.currentPeriodEnd),
  );

  return {
    generated_at: data.generatedAt,
    active_customers: data.summary.activeCustomers,
    past_due_customers: data.summary.delinquentCustomers,
    // O resumo v2 não carrega currency. Só é exibido como BRL quando os
    // registros confirmam BRL; nunca somamos moedas diferentes.
    mrr_cents: currencies.size === 1 && currencies.has("BRL") ? data.summary.activeMrrMinor : null,
    mrr_at_risk_cents:
      currencies.size === 1 && currencies.has("BRL") ? data.summary.mrrAtRiskMinor : null,
    customer_count: customers.size,
    vendas_hoje_count: pagosHoje.length,
    vendas_hoje_cents: pagosHoje.reduce((sum, row) => sum + row.amountPaidMinor, 0),
    vendas_mes_count: pagosMes.length,
    vendas_mes_cents: pagosMes.reduce((sum, row) => sum + row.amountPaidMinor, 0),
    a_receber_30d_count: renovacoes30d.length,
    a_receber_30d_cents: renovacoes30d.reduce((sum, row) => sum + row.amountMinor, 0),
    subscriptions: [...subscriptions.values()].map((row) => ({
      id: key(row.provider, row.externalId),
      provider: row.provider,
      ...personFor(row.provider, row.customerExternalId),
      status: row.status,
      amount_cents: row.amountMinor,
      currency: row.currency.toUpperCase(),
      interval: row.billingInterval,
      interval_count: row.intervalCount,
      renews_at: row.currentPeriodEnd,
    })),
    payments: [...payments.values()].map((row) => ({
      id: key(row.provider, row.externalId),
      provider: row.provider,
      ...personFor(row.provider, row.customerExternalId),
      status: row.status,
      amount_cents: row.amountPaidMinor,
      amount_due_cents: row.amountDueMinor,
      currency: row.currency.toUpperCase(),
      paid_at: row.paidAt,
      due_at: row.dueAt,
    })),
  };
}

export type StripeDashboard = ReturnType<typeof normalizeStripe>;
export type OtherDashboard = ReturnType<typeof normalizeOther>;
export type BillingDashboard = {
  fetched_at: string;
  stripe: SourceResult<StripeDashboard>;
  other: SourceResult<OtherDashboard>;
};
