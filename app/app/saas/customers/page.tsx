import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { loadSaaSCustomers, type SaaSCustomer } from "@/lib/saas/customer360";
import {
  FILTROS_DE_STATUS, ROTULO_DO_MOVIMENTO, emRisco, filtrarClientes, loadCustomerDetail, resumoDaBase,
  type FichaDoCliente,
} from "@/lib/saas/customer360-detail";

// Customer 360 no formato do Gravity CRM (crm.ia): lista com busca e filtro à
// esquerda, a ficha do cliente à direita. Tudo por parâmetro de URL — cada
// cliente tem link próprio e a tela funciona sem estado no navegador.
export const dynamic = "force-dynamic";
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const data = (v: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");
const STATUS = {
  active: ["Ativo", "success"], past_due: ["Inadimplente", "error"], canceling: ["Cancelando", "warning"],
  churned: ["Cancelado", "neutral"], unknown: ["Sem status", "neutral"],
} as const;
const SAUDE = {
  healthy: ["Saudável", "success"], attention: ["Atenção", "warning"], high_risk: ["Risco alto", "error"],
  critical: ["Crítico", "error"], insufficient_data: ["Sem dados de uso", "neutral"],
} as const;
const PRIORIDADE = { critical: ["Crítica", "error"], high: ["Alta", "warning"], medium: ["Média", "info"], low: ["Baixa", "neutral"] } as const;
const SUB = { active: "Ativa", past_due: "Inadimplente", canceling: "Cancelando", canceled: "Cancelada", unknown: "Sem status" } as Record<string, string>;

function linkPara(params: { q?: string; status?: string }, conta?: string) {
  const u = new URLSearchParams();
  if (params.q) u.set("q", params.q);
  if (params.status && params.status !== "todos") u.set("status", params.status);
  if (conta) u.set("account", conta);
  const s = u.toString();
  return "/app/saas/customers" + (s ? "?" + s : "");
}

function Lista({ itens, ativo, params }: { itens: SaaSCustomer[]; ativo: string | null; params: { q?: string; status?: string } }) {
  return (
    <Card className="flex max-h-[calc(100vh-220px)] flex-col overflow-hidden">
      <form className="border-b p-3" action="/app/saas/customers">
        {params.status && params.status !== "todos" ? <input type="hidden" name="status" value={params.status} /> : null}
        <Input name="q" defaultValue={params.q ?? ""} placeholder="Buscar cliente ou fonte" aria-label="Buscar cliente" />
      </form>
      <nav className="flex flex-wrap gap-1.5 border-b p-3" aria-label="Filtrar por situação">
        {FILTROS_DE_STATUS.map((f) => {
          const on = (params.status ?? "todos") === f.id;
          return (
            <Link key={f.id} href={linkPara({ q: params.q, status: f.id })} aria-current={on ? "page" : undefined}
              className={"rounded-full border px-2.5 py-1 text-xs " + (on ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
              {f.label}
            </Link>
          );
        })}
      </nav>
      <ul className="flex-1 divide-y overflow-y-auto">
        {itens.map((c) => (
          <li key={c.id}>
            <Link href={linkPara(params, c.id)} aria-current={c.id === ativo ? "true" : undefined}
              className={"flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/50 " + (c.id === ativo ? "bg-muted" : "")}>
              <span className="min-w-0">
                <span className="block truncate font-medium">{c.name}</span>
                <span className="text-xs text-muted-foreground">{STATUS[c.status][0]}{emRisco(c) ? " · em risco" : ""}</span>
              </span>
              <span className="shrink-0 tabular-nums">{brl.format(c.mrrCents / 100)}</span>
            </Link>
          </li>
        ))}
        {!itens.length ? <li className="p-6 text-center text-sm text-muted-foreground">Nenhum cliente com esse filtro.</li> : null}
      </ul>
    </Card>
  );
}

function Ficha({ c, ficha }: { c: SaaSCustomer; ficha: FichaDoCliente | null }) {
  const acao = ficha?.acoes[0];
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-semibold">{c.name}</h2>
              <Badge variant={STATUS[c.status][1]}>{STATUS[c.status][0]}</Badge>
              <Badge variant={SAUDE[c.healthBand][1]}>{SAUDE[c.healthBand][0]}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{c.evidence.join(" · ")}</p>
            <p className="mt-1 text-xs text-muted-foreground">Fontes: {c.sources.join(" · ") || "—"}</p>
          </div>
          <div className="flex gap-6 text-sm">
            <div><p className="text-xs text-muted-foreground">MRR</p><b className="tabular-nums">{brl.format(c.mrrCents / 100)}</b></div>
            <div><p className="text-xs text-muted-foreground">Em risco</p><b className="tabular-nums">{c.mrrAtRiskCents ? brl.format(c.mrrAtRiskCents / 100) : "—"}</b></div>
            <div><p className="text-xs text-muted-foreground">Último uso</p><b>{c.lastUseAt ? data(c.lastUseAt) : "Sem telemetria"}</b></div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {c.contactId
            ? <Button asChild size="sm" variant="outline"><Link href={`/app/contacts/${c.contactId}`}>Abrir conversa e histórico</Link></Button>
            : <Button asChild size="sm" variant="outline"><Link href="/app/contacts">Vincular a um contato</Link></Button>}
          <Button asChild size="sm" variant="ghost"><Link href="/app/saas/health">Ver saúde da base</Link></Button>
        </div>
      </Card>

      <Card className={acao || c.nextAction ? "border-warning/40 p-5" : "p-5"}>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Próxima ação</p>
        <p className="mt-2 font-medium">{acao?.titulo || c.nextAction || "Acompanhar — nenhum sinal pede ação agora."}</p>
        {acao ? <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={PRIORIDADE[acao.prioridade][1]}>{PRIORIDADE[acao.prioridade][0]}</Badge>
          {acao.impactoCents ? <span>Receita em jogo: <b className="text-foreground">{brl.format(acao.impactoCents / 100)}</b></span> : null}
          <Link className="underline" href="/app/saas/actions">Resolver no Action Center</Link>
        </div> : null}
      </Card>

      {!ficha ? <Card className="p-5 text-sm text-muted-foreground">Não foi possível carregar o detalhe deste cliente agora.</Card> : <>
        <Card className="overflow-hidden">
          <h3 className="border-b p-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assinaturas</h3>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th className="p-3">Fonte</th><th>Situação</th><th>MRR</th><th>Início</th><th>Atualizada</th></tr></thead>
            <tbody className="divide-y">{ficha.assinaturas.map((s) => <tr key={s.id}><td className="p-3">{s.fonte}</td><td>{SUB[s.status] ?? s.status}</td><td className="tabular-nums">{brl.format(s.mrrCents / 100)}</td><td>{data(s.inicio)}</td><td>{data(s.vistoEm)}</td></tr>)}
              {!ficha.assinaturas.length ? <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Sem assinatura registrada.</td></tr> : null}</tbody></table></div>
        </Card>
        <Card className="overflow-hidden">
          <h3 className="border-b p-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Movimentos de receita</h3>
          <ol className="divide-y">{ficha.movimentos.map((m) => <li key={m.id} className="flex items-center justify-between gap-3 p-4 text-sm">
            <span><b>{ROTULO_DO_MOVIMENTO[m.tipo]}</b><span className="ml-2 text-xs text-muted-foreground">{data(m.em)}</span></span>
            <span className={"tabular-nums " + (m.deltaCents < 0 ? "text-destructive" : "")}>{m.deltaCents > 0 ? "+" : ""}{brl.format(m.deltaCents / 100)} <span className="text-xs text-muted-foreground">→ {brl.format(m.atualCents / 100)}</span></span>
          </li>)}{!ficha.movimentos.length ? <li className="p-4 text-center text-sm text-muted-foreground">Nenhum movimento depois da primeira carga (baseline).</li> : null}</ol>
        </Card>
      </>}
    </div>
  );
}

export default async function Customers({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; account?: string }> }) {
  const user = await requireAuth(), org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  if (!user.is_platform_admin && ROLE_RANK[org.role] < ROLE_RANK.manager) redirect("/403");
  const params = await searchParams;
  const todos = await loadSaaSCustomers(org.orgId).catch(() => [] as SaaSCustomer[]);
  const itens = filtrarClientes(todos, params);
  const atual = itens.find((c) => c.id === params.account) ?? itens[0] ?? null;
  const ficha = atual ? await loadCustomerDetail(org.orgId, atual.id).catch(() => null) : null;
  const r = resumoDaBase(todos);
  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5">
      <header>
        <Badge variant="info">Customer Success</Badge>
        <h1 className="mt-3 text-3xl font-semibold">Clientes</h1>
        <p className="mt-1 text-sm text-muted-foreground">Cada cliente numa ficha só: assinatura, receita, uso, saúde e a próxima ação.</p>
      </header>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[["Clientes pagantes", String(r.clientes)], ["MRR da base", brl.format(r.mrrCents / 100)], ["Em risco", `${r.emRisco} · ${brl.format(r.mrrEmRiscoCents / 100)}`], ["Sem contato vinculado", String(r.semContato)]]
          .map(([l, v]) => <Card key={l} className="p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="mt-2 text-xl font-semibold tabular-nums">{v}</p></Card>)}
      </section>
      {!todos.length ? <Card className="p-8 text-center text-muted-foreground">Nenhuma conta SaaS conectada ainda. Conecte uma fonte de receita (escopo <code>saas_revenue:write</code>) para formar a base.</Card> :
        <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
          <Lista itens={itens} ativo={atual?.id ?? null} params={params} />
          {atual ? <Ficha c={atual} ficha={ficha} /> : <Card className="p-8 text-center text-muted-foreground">Nenhum cliente com esse filtro.</Card>}
        </div>}
    </div>
  );
}
