import "server-only";

import { env } from "@/lib/env";
import { diaBR, hojeBR, dentroDe30Dias, type StripeDashboard } from "./contracts";

/**
 * O que este módulo NÃO recalcula (ver cabeçalho): histórico mensal e LTV
 * continuam vindo do resumo do admin. O chamador faz `{ ...stripeDoAdmin,
 * ...fetchStripeDirect() }`.
 */
export type StripeDireto = Omit<
  StripeDashboard,
  "monthly_revenue" | "lifetime_revenue_cents" | "receita_mes_atual_cents" | "receita_mes_atual_label"
>;

/**
 * Números da Stripe calculados DIRETO na Stripe, não pelo resumo que o admin
 * do PeríciaIA expõe em `billing-export`.
 *
 * Por quê: medido em 2026-09-27, paginando a Stripe de verdade —
 * `summary.activeCount` daquela fonte reporta 42, mas as assinaturas com
 * `status=active` na Stripe são 7; 42 é exatamente a contagem de CANCELADAS.
 * O bug está na consulta do backend do PeríciaIA (fora deste repo), não em
 * como este painel lê os dados — mas MRR, ARR, plano por assinatura e
 * renovações são todos calculados a partir do mesmo conjunto errado, então
 * corrigir só a contagem deixaria os outros números igualmente errados.
 *
 * Este módulo é a fonte de verdade para os campos que aquele bug contamina.
 * Histórico mensal e receita vitalícia (LTV) continuam vindo do resumo do
 * admin — não são afetados pela mesma consulta (são agregados por pagamento
 * já ocorrido, não por status atual) e recalculá-los aqui exigiria paginar
 * todo o histórico de faturas, fora de escopo por ora.
 */

type StripeSubscription = {
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end: number;
  canceled_at: number | null;
  customer: { id: string; name: string | null; email: string | null } | string;
  items: { data: Array<{ price: { unit_amount: number | null; recurring: { interval: string; interval_count: number } | null; nickname: string | null; product: string | { name?: string } } }> };
};

async function stripeGet<T>(path: string, params: [string, string][] = []): Promise<T> {
  const qs = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const res = await fetch(`https://api.stripe.com/v1/${path}${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${env.STRIPE_SECRET_KEY}:`).toString("base64")}` },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`stripe_http_${res.status}`);
  return res.json() as Promise<T>;
}

async function paginateSubscriptions(status: string): Promise<StripeSubscription[]> {
  const out: StripeSubscription[] = [];
  let startingAfter: string | null = null;
  for (let page = 0; page < 20; page++) {
    const params: [string, string][] = [
      ["status", status],
      ["limit", "100"],
      ["expand[]", "data.customer"],
      ["expand[]", "data.items.data.price.product"],
    ];
    if (startingAfter) params.push(["starting_after", startingAfter]);
    const body: { data: StripeSubscription[]; has_more: boolean } = await stripeGet("subscriptions", params);
    out.push(...body.data);
    if (!body.has_more) break;
    startingAfter = body.data.at(-1)?.id ?? null;
  }
    return out;
}

function customerOf(sub: StripeSubscription): { name: string | null; email: string | null } {
  if (typeof sub.customer === "string") return { name: null, email: null };
  return { name: sub.customer.name ?? null, email: sub.customer.email ?? null };
}

function planLabel(sub: StripeSubscription): string {
  const price = sub.items.data[0]?.price;
  if (!price) return "Sem plano";
  const product = price.product;
  if (typeof product === "object" && product?.name) return product.name;
  return price.nickname ?? "Sem plano";
}

const NOVENTA_DIAS_S = 90 * 24 * 60 * 60;

export async function fetchStripeDirect(): Promise<StripeDireto | null> {
  if (!env.STRIPE_SECRET_KEY) return null;

  const [active, pastDue, canceled] = await Promise.all([
    paginateSubscriptions("active"),
    paginateSubscriptions("past_due"),
    paginateSubscriptions("canceled"),
  ]);

  const cents = (unitAmount: number | null, intervalCount: number, interval: string | undefined): number => {
    const amount = unitAmount ?? 0;
    if (interval === "year") return Math.round(amount / (12 * intervalCount));
    if (interval === "week") return Math.round((amount * 52) / (12 * intervalCount));
    return Math.round(amount / intervalCount);
  };

  let mrrCents = 0;
  const planMap = new Map<string, { count: number; mrr_cents: number }>();
  for (const sub of active) {
    const price = sub.items.data[0]?.price;
    const monthly = cents(price?.unit_amount ?? null, price?.recurring?.interval_count ?? 1, price?.recurring?.interval);
    mrrCents += monthly;
    const label = planLabel(sub);
    const entry = planMap.get(label) ?? { count: 0, mrr_cents: 0 };
    entry.count += 1;
    entry.mrr_cents += monthly;
    planMap.set(label, entry);
  }

  const agora = Date.now() / 1000;
  const churned90d = canceled.filter((s) => s.canceled_at && agora - s.canceled_at <= NOVENTA_DIAS_S).length;

  const renewals = active
    .slice()
    .sort((a, b) => a.current_period_end - b.current_period_end)
    .slice(0, 50)
    .map((sub) => ({
      name: customerOf(sub).name,
      email: customerOf(sub).email,
      renews_at: new Date(sub.current_period_end * 1000).toISOString(),
      canceling: sub.cancel_at_period_end,
    }));

  // "Pagamentos recentes" — faturas pagas mais recentes, não amostra: a Stripe
  // já ordena por criação desc por padrão.
  const invoices = await stripeGet<{
    data: Array<{ customer_name: string | null; customer_email: string | null; amount_paid: number; status_transitions: { paid_at: number | null }; created: number }>;
  }>("invoices", [
    ["status", "paid"],
    ["limit", "10"],
  ]);
  const payments = invoices.data.map((inv) => ({
    name: inv.customer_name,
    email: inv.customer_email,
    amount_cents: inv.amount_paid,
    paid_at: new Date((inv.status_transitions.paid_at ?? inv.created) * 1000).toISOString(),
  }));

  // Não é amostra igual à do admin (aqui são as 10 faturas pagas mais
  // recentes de verdade, não um recorte fixo de 5) — mas o nome do campo é
  // herdado do contrato, então o rótulo "verificado" na tela é quem conta a
  // diferença, não o nome da propriedade.
  const hoje = hojeBR();
  const vendasHoje = payments.filter((p) => diaBR(p.paid_at) === hoje);
  const renovacoes30d = renewals.filter((r) => dentroDe30Dias(r.renews_at));

  return {
    generated_at: new Date().toISOString(),
    verificado_direto: true,
    mrr_cents: mrrCents,
    arr_cents: mrrCents * 12,
    active_subscriptions: active.length,
    past_due_count: pastDue.length,
    churn_rate_90d: active.length + churned90d > 0 ? Math.round((churned90d / (active.length + churned90d)) * 1000) / 10 : 0,
    churned_90d: churned90d,
    canceling_count: active.filter((s) => s.cancel_at_period_end).length,
    plans: [...planMap.entries()].map(([name, v]) => ({ name, ...v })),
    renewals,
    payments,
    past_due: pastDue.map((sub) => customerOf(sub)),
    vendas_hoje_amostra_count: vendasHoje.length,
    vendas_hoje_amostra_cents: vendasHoje.reduce((sum, p) => sum + p.amount_cents, 0),
    renovacoes_30d_count: renovacoes30d.length,
  };
}
