import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { loadSaaSCustomers, type SaaSCustomer } from "@/lib/saas/customer360";
import { loadCustomerActionCenter } from "@/lib/saas/actions";
import { COMO_DECIDIMOS, FAIXAS, coberturaDeUso, distribuicaoDeSaude, filtrarPorFaixa } from "@/lib/saas/saude-da-base";

// Saúde da base no formato do Gravity CRM (crm.ia): distribuição por faixa
// (clicável), fila de ação prioritária, cobertura de telemetria e a lista.
export const dynamic = "force-dynamic";
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });
const PRIORIDADE = { critical: ["Crítica", "error"], high: ["Alta", "warning"], medium: ["Média", "info"], low: ["Baixa", "neutral"] } as const;

export default async function Health({ searchParams }: { searchParams: Promise<{ faixa?: string }> }) {
  const user = await requireAuth(), org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  if (!user.is_platform_admin && ROLE_RANK[org.role] < ROLE_RANK.manager) redirect("/403");
  const { faixa } = await searchParams;
  const [todos, acoes] = await Promise.all([
    loadSaaSCustomers(org.orgId).catch(() => [] as SaaSCustomer[]),
    loadCustomerActionCenter(org.orgId).catch(() => ({ items: [], names: new Map<string, string>() })),
  ]);
  const dist = distribuicaoDeSaude(todos);
  const cobertura = coberturaDeUso(todos);
  const lista = filtrarPorFaixa(todos, faixa);
  const fila = acoes.items.slice(0, 5);
  const banda = Object.fromEntries(FAIXAS.map((f) => [f.id, f]));

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge variant="info">Customer Success</Badge>
          <h1 className="mt-3 text-3xl font-semibold">Saúde da base</h1>
          <p className="mt-1 text-sm text-muted-foreground">Quem está bem, quem pede atenção e quanto de receita está em jogo.</p>
        </div>
        <Button asChild variant="outline"><Link href="/app/saas/actions">Abrir Action Center</Link></Button>
      </header>

      <section className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5" aria-label="Distribuição por faixa">
        {dist.map((d) => {
          const on = faixa === d.id;
          return (
            <Link key={d.id} href={on ? "/app/saas/health" : `/app/saas/health?faixa=${d.id}`} aria-current={on ? "true" : undefined}>
              <Card className={"h-full p-4 transition hover:bg-muted/40 " + (on ? "ring-2 ring-foreground" : "")}>
                <Badge variant={d.variant}>{d.label}</Badge>
                <p className="mt-3 text-2xl font-semibold tabular-nums">{d.clientes}</p>
                <p className="text-xs text-muted-foreground tabular-nums">{brl.format(d.mrrCents / 100)} de MRR</p>
              </Card>
            </Link>
          );
        })}
      </section>

      <section className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card className="overflow-hidden">
          <div className="border-b p-5">
            <h2 className="font-semibold">Fila de ação prioritária</h2>
            <p className="mt-1 text-xs text-muted-foreground">As ações abertas mais urgentes; resolva e registre o desfecho no Action Center.</p>
          </div>
          <ul className="divide-y">
            {fila.map((a) => {
              const p = PRIORIDADE[a.priority];
              return (
                <li key={a.id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><Badge variant={p[1]}>{p[0]}</Badge>
                      <Link className="text-sm font-semibold hover:underline" href={`/app/saas/customers?account=${a.account_id}`}>{acoes.names.get(a.account_id) || "Cliente SaaS"}</Link></div>
                    <p className="mt-1 text-sm">{a.title}</p>
                  </div>
                  {a.revenue_impact_cents > 0 ? <span className="text-sm tabular-nums text-muted-foreground">{brl.format(a.revenue_impact_cents / 100)} em jogo</span> : null}
                </li>
              );
            })}
            {!fila.length ? <li className="p-6 text-center text-sm text-muted-foreground">Nenhuma ação prioritária aberta agora.</li> : null}
          </ul>
        </Card>
        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <h2 className="font-semibold">Cobertura de uso do produto</h2>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{cobertura.taxa == null ? "—" : pct.format(cobertura.taxa)}</p>
            <p className="text-xs text-muted-foreground">{cobertura.comUso} de {cobertura.pagantes} clientes com uso chegando.</p>
            {cobertura.taxa !== null && cobertura.taxa < 1 ? <p className="mt-3 text-xs text-muted-foreground">Sem uso, a nota só enxerga a cobrança. Envie eventos do aplicativo com o escopo <code>product_events:write</code>.</p> : null}
          </Card>
          <Card className="p-5">
            <h2 className="font-semibold">Como a nota é decidida</h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-4 text-xs leading-5 text-muted-foreground">{COMO_DECIDIMOS.map((t) => <li key={t}>{t}</li>)}</ul>
          </Card>
        </div>
      </section>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b p-5">
          <h2 className="font-semibold">{faixa && banda[faixa] ? `Clientes · ${banda[faixa].label}` : "Todos os clientes"}</h2>
          {faixa ? <Link className="text-xs underline" href="/app/saas/health">Limpar filtro</Link> : null}
        </div>
        <ul className="divide-y">
          {lista.map((x) => {
            const b = banda[x.healthBand];
            return (
              <li key={x.id} className="flex flex-col gap-2 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><Link className="font-semibold hover:underline" href={`/app/saas/customers?account=${x.id}`}>{x.name}</Link>{b ? <Badge variant={b.variant}>{b.label}</Badge> : null}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{x.evidence.join(" · ")}</p>
                </div>
                <div className="flex gap-8 text-sm">
                  <div><p className="text-xs text-muted-foreground">MRR</p><b className="tabular-nums">{brl.format(x.mrrCents / 100)}</b></div>
                  <div><p className="text-xs text-muted-foreground">Em risco</p><b className="tabular-nums">{x.mrrAtRiskCents ? brl.format(x.mrrAtRiskCents / 100) : "—"}</b></div>
                  <div className="min-w-48"><p className="text-xs text-muted-foreground">Próxima ação</p><b>{x.nextAction || "Acompanhar"}</b></div>
                </div>
              </li>
            );
          })}
          {!lista.length ? <li className="p-8 text-center text-sm text-muted-foreground">{todos.length ? "Nenhum cliente nessa faixa." : "Conecte receita e eventos do produto para formar a primeira nota."}</li> : null}
        </ul>
      </Card>
    </div>
  );
}
