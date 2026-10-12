import { createAdminClient } from "@/lib/supabase/admin";
import type { SaaSCustomer } from "@/lib/saas/customer360";

// Ficha do cliente (Customer 360) — trazida do Gravity CRM (crm.ia) na fusão,
// reescrita sobre o core SaaS deste CRM (saas_accounts, revenue_*, customer_action_items).
// As funções puras abaixo decidem o que a tela mostra; a leitura do banco fica no fim.

export type FiltroDeStatus = "todos" | "em_risco" | SaaSCustomer["status"];
export const FILTROS_DE_STATUS: { id: FiltroDeStatus; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "em_risco", label: "Em risco" },
  { id: "active", label: "Ativos" },
  { id: "past_due", label: "Inadimplentes" },
  { id: "canceling", label: "Cancelando" },
  { id: "churned", label: "Cancelados" },
];

const semAcento = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function emRisco(c: Pick<SaaSCustomer, "healthBand" | "status">): boolean {
  return c.healthBand === "critical" || c.healthBand === "high_risk" || c.status === "past_due" || c.status === "canceling";
}

export function filtrarClientes(items: SaaSCustomer[], filtro: { q?: string; status?: string }): SaaSCustomer[] {
  const q = semAcento(String(filtro.q ?? "").trim());
  const status = (FILTROS_DE_STATUS.some((f) => f.id === filtro.status) ? filtro.status : "todos") as FiltroDeStatus;
  return items.filter((c) => {
    if (status === "em_risco" && !emRisco(c)) return false;
    if (status !== "todos" && status !== "em_risco" && c.status !== status) return false;
    if (!q) return true;
    return semAcento([c.name, ...c.sources].join(" ")).includes(q) || c.id.startsWith(q);
  });
}

export function resumoDaBase(items: SaaSCustomer[]) {
  const ativos = items.filter((c) => c.status === "active" || c.status === "past_due" || c.status === "canceling");
  return {
    clientes: ativos.length,
    mrrCents: ativos.reduce((n, c) => n + c.mrrCents, 0),
    emRisco: items.filter(emRisco).length,
    mrrEmRiscoCents: items.reduce((n, c) => n + c.mrrAtRiskCents, 0),
    semContato: items.filter((c) => !c.contactId).length,
  };
}

export type MovimentoDeMrr = { id: string; tipo: "new" | "expansion" | "contraction" | "reactivation" | "churn"; em: string; deltaCents: number; atualCents: number };
export const ROTULO_DO_MOVIMENTO: Record<MovimentoDeMrr["tipo"], string> = {
  new: "Nova assinatura",
  expansion: "Expansão",
  contraction: "Contração",
  reactivation: "Reativação",
  churn: "Cancelamento",
};

export type Assinatura = { id: string; fonte: string; status: string; mrrCents: number; inicio: string | null; fim: string | null; vistoEm: string };
export type AcaoAberta = { id: string; titulo: string; prioridade: "critical" | "high" | "medium" | "low"; impactoCents: number; criadaEm: string };
export type FichaDoCliente = { assinaturas: Assinatura[]; movimentos: MovimentoDeMrr[]; acoes: AcaoAberta[]; fontes: { fonte: string; externo: string }[] };

const PESO_PRIORIDADE = { critical: 0, high: 1, medium: 2, low: 3 } as const;

/** Monta a ficha a partir das linhas cruas (testável sem banco). */
export function montarFicha(linhas: {
  subs: Array<Record<string, unknown>>;
  eventos: Array<Record<string, unknown>>;
  acoes: Array<Record<string, unknown>>;
  ids: Array<Record<string, unknown>>;
}): FichaDoCliente {
  return {
    assinaturas: linhas.subs
      .map((s) => ({
        id: String(s.id), fonte: String(s.source ?? ""), status: String(s.status ?? "unknown"),
        mrrCents: Number(s.mrr_cents || 0), inicio: s.started_at ? String(s.started_at) : null,
        fim: s.ended_at ? String(s.ended_at) : null, vistoEm: String(s.last_observed_at ?? ""),
      }))
      .sort((a, b) => Number(b.status !== "canceled") - Number(a.status !== "canceled") || b.mrrCents - a.mrrCents),
    movimentos: linhas.eventos
      .map((e) => ({ id: String(e.id), tipo: String(e.event_type) as MovimentoDeMrr["tipo"], em: String(e.effective_at), deltaCents: Number(e.delta_cents || 0), atualCents: Number(e.current_mrr_cents || 0) }))
      .filter((m) => m.tipo in ROTULO_DO_MOVIMENTO)
      .sort((a, b) => b.em.localeCompare(a.em)),
    acoes: linhas.acoes
      .filter((a) => a.status === "open")
      .map((a) => ({ id: String(a.id), titulo: String(a.title ?? ""), prioridade: (String(a.priority) as AcaoAberta["prioridade"]) in PESO_PRIORIDADE ? (String(a.priority) as AcaoAberta["prioridade"]) : "low", impactoCents: Number(a.revenue_impact_cents || 0), criadaEm: String(a.created_at ?? "") }))
      .sort((a, b) => PESO_PRIORIDADE[a.prioridade] - PESO_PRIORIDADE[b.prioridade] || b.impactoCents - a.impactoCents),
    fontes: linhas.ids.map((i) => ({ fonte: String(i.source ?? ""), externo: String(i.external_customer_id ?? "") })),
  };
}

/** Lê a ficha de UMA conta, sempre presa à organização (nunca só pelo id). */
export async function loadCustomerDetail(organizationId: string, accountId: string): Promise<FichaDoCliente> {
  const a = createAdminClient();
  const [sr, er, ar, ir] = await Promise.all([
    a.from("revenue_subscription_states").select("id,source,status,mrr_cents,started_at,ended_at,last_observed_at").eq("organization_id", organizationId).eq("account_id", accountId),
    a.from("revenue_mrr_events").select("id,event_type,effective_at,delta_cents,current_mrr_cents").eq("organization_id", organizationId).eq("account_id", accountId).order("effective_at", { ascending: false }).limit(24),
    a.from("customer_action_items").select("id,title,priority,status,revenue_impact_cents,created_at").eq("organization_id", organizationId).eq("account_id", accountId).eq("status", "open"),
    a.from("saas_account_identities").select("source,external_customer_id").eq("organization_id", organizationId).eq("account_id", accountId),
  ]);
  for (const r of [sr, er, ar, ir]) if (r.error) throw r.error;
  return montarFicha({ subs: sr.data ?? [], eventos: er.data ?? [], acoes: ar.data ?? [], ids: ir.data ?? [] });
}
