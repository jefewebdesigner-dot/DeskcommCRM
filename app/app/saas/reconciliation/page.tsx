import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { loadRevenueReconciliation } from "@/lib/saas/reconciliation";

// Conciliação funil × financeiro — tela do Gravity CRM (crm.ia) trazida na
// fusão. É o passo "reconciliar sem duplicar" do cutover da PeríciaIA
// (docs/architecture/periciaia-gravity-crm-fusion.md): mostra onde o CRM e a
// cobrança discordam sobre quem é lead e quem é cliente. Só leitura.
export const dynamic = "force-dynamic";

export default async function Reconciliation() {
  const user = await requireAuth(), org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  if (!user.is_platform_admin && ROLE_RANK[org.role] < ROLE_RANK.manager) redirect("/403");
  const r = await loadRevenueReconciliation(org.orgId).catch(() => null);

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge variant="info">Receita</Badge>
          <h1 className="mt-3 text-3xl font-semibold">Conciliação de receita</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Onde o funil de vendas e a cobrança discordam sobre quem é lead e quem já é cliente.</p>
        </div>
        <Button asChild variant="outline" size="sm"><Link href="/app/saas/customers">Abrir Clientes</Link></Button>
      </header>

      {!r ? <Card className="p-8 text-center text-muted-foreground">Não foi possível ler o funil e a cobrança agora.</Card> : <>
        <section aria-labelledby="populacoes" className="flex flex-col gap-3">
          <h2 id="populacoes" className="text-sm font-semibold">Quem é quem, segundo a regra de verdade</h2>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {([
              ["Leads válidos", r.counts.validLeads, "Em funil aberto e ainda não clientes"],
              ["Pagamento pendente", r.counts.pendingPayment, "Ganhos no funil sem assinatura confirmada"],
              ["Clientes ativos", r.counts.activeCustomers, "Assinatura ativa na cobrança"],
              ["Inadimplentes", r.counts.delinquentCustomers, "Pagamento em atraso"],
              ["Cancelando", r.counts.cancelingCustomers, "Cancelamento agendado"],
              ["Cancelados", r.counts.canceledCustomers, "Sem assinatura viva"],
            ] as const).map(([l, v, d]) => (
              <Card key={l} className="p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{v}</p><p className="mt-1 text-xs text-muted-foreground">{d}</p></Card>
            ))}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[2fr_1fr]">
          <Card className="overflow-hidden">
            <div className="border-b p-5"><h2 className="font-semibold">Divergências encontradas</h2><p className="mt-1 text-xs text-muted-foreground">Da maior para a menor. Zero é o estado esperado.</p></div>
            <ul className="divide-y">
              {r.issues.map((i) => (
                <li key={i.key} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><b>{i.label}</b><Badge variant={i.count ? i.tone : "success"}>{i.count ? i.recommendation : "Em dia"}</Badge><span className="text-xs text-muted-foreground">{i.source}</span></div>
                    <p className="mt-1 text-sm text-muted-foreground">{i.explanation}</p>
                  </div>
                  <span className="text-2xl font-semibold tabular-nums">{i.count}</span>
                </li>
              ))}
            </ul>
          </Card>
          <div className="flex flex-col gap-4">
            <Card className="p-5">
              <h2 className="font-semibold">Regra de verdade</h2>
              <ul className="mt-3 list-disc space-y-1.5 pl-4 text-xs leading-5 text-muted-foreground">
                <li>Quem é cliente decide a <b>cobrança</b>: assinatura ativa, inadimplente ou cancelando.</li>
                <li>Cliente atual não conta como lead, mesmo com card aberto no funil.</li>
                <li>Ganho no funil sem assinatura confirmada fica como pagamento pendente.</li>
                <li>Histórico financeiro importado não entra como oportunidade comercial.</li>
              </ul>
            </Card>
            <Card className="p-5">
              <h2 className="font-semibold">Fontes observadas</h2>
              <p className="mt-2 text-xs text-muted-foreground">Financeiras: <b className="text-foreground">{r.financialSources.join(" · ") || "nenhuma ainda"}</b></p>
              <ul className="mt-3 space-y-1 text-xs">{r.commercialSources.slice(0, 8).map((s) => <li key={s.source} className="flex justify-between gap-3"><span className="text-muted-foreground">{s.source}</span><b className="tabular-nums">{s.count}</b></li>)}</ul>
            </Card>
            <Card className="p-5">
              <h2 className="font-semibold">Qualidade do cadastro</h2>
              <ul className="mt-3 space-y-1 text-xs">
                {([
                  ["Cards no funil", r.quality.rawLeadRecords], ["Contatos únicos no funil", r.quality.uniqueLeadContacts],
                  ["Contatos com mais de um card", r.quality.contactsWithMultipleLeads], ["Contas de cobrança sem contato", r.quality.accountsWithoutContact],
                ] as const).map(([l, v]) => <li key={l} className="flex justify-between gap-3"><span className="text-muted-foreground">{l}</span><b className="tabular-nums">{v}</b></li>)}
              </ul>
            </Card>
          </div>
        </section>

        <Card className="overflow-hidden">
          <h2 className="border-b p-5 font-semibold">Cards por etapa</h2>
          <ul className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
            {r.stages.map((s) => <li key={s.name} className="flex items-center justify-between gap-3 bg-card p-4 text-sm"><span>{s.name}{s.terminal !== "open" ? <span className="ml-2 text-xs text-muted-foreground">{s.terminal === "won" ? "ganho" : "perda"}</span> : null}</span><b className="tabular-nums">{s.count}</b></li>)}
            {!r.stages.length ? <li className="bg-card p-6 text-center text-sm text-muted-foreground sm:col-span-2 xl:col-span-4">Nenhum card no funil.</li> : null}
          </ul>
        </Card>
      </>}
    </div>
  );
}
