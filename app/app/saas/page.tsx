import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { loadRevenueOverview } from "@/lib/saas/revenue";
import { loadSaaSCustomers } from "@/lib/saas/customer360";

export const dynamic="force-dynamic";
const brl=new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:0});
const pct=new Intl.NumberFormat("pt-BR",{style:"percent",maximumFractionDigits:1});

export default async function SaaSHub(){
  const user=await requireAuth(),org=await resolveActiveOrg(user);
  if(!org)redirect("/app"); if(!user.is_platform_admin&&ROLE_RANK[org.role]<ROLE_RANK.manager)redirect("/403");
  const [r,c]=await Promise.all([loadRevenueOverview(org.orgId).catch(()=>null),loadSaaSCustomers(org.orgId).catch(()=>[])]);
  const risk=c.filter((x)=>x.healthBand==="critical"||x.healthBand==="high_risk");
  return <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6">
    <header><Badge variant="info">Gravity CRM · SaaS OS</Badge><h1 className="mt-3 text-3xl font-semibold tracking-tight">Operação SaaS</h1>
      <p className="mt-1 text-sm text-muted-foreground">Receita, clientes, uso do produto e retenção na mesma operação.</p></header>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {[
        ["MRR",r?brl.format(r.mrrCents/100):"—"],
        ["ARR",r?brl.format(r.arrCents/100):"—"],
        ["Clientes ativos",r?String(r.activeCustomers):"—"],
        ["MRR em risco",r?brl.format(r.mrrAtRiskCents/100):"—"],
        ["NRR",r?.nrrRate==null?"Histórico em formação":pct.format(r.nrrRate)],
      ].map(([l,v])=><Card key={l} className="p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{v}</p></Card>)}
    </section>
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Link href="/app/saas/customers"><Card className="h-full p-5"><h2 className="font-semibold">Customer 360</h2><p className="mt-2 text-sm text-muted-foreground">{c.length} contas conectadas. Receita, fonte e uso numa identidade.</p></Card></Link>
      <Link href="/app/saas/health"><Card className="h-full p-5"><h2 className="font-semibold">Saúde da base</h2><p className="mt-2 text-sm text-muted-foreground">{risk.length} cliente(s) em risco alto ou crítico para priorizar agora.</p></Card></Link>
      <Link href="/app/saas/actions"><Card className="h-full p-5"><h2 className="font-semibold">Action Center</h2><p className="mt-2 text-sm text-muted-foreground">Transforma sinais de risco em próximos passos operacionais, sem depender de leitura manual.</p></Card></Link>
      <Link href="/app/saas/revenue"><Card className="h-full p-5"><h2 className="font-semibold">Revenue OS</h2><p className="mt-2 text-sm text-muted-foreground">Novo MRR, expansão, contração, churn, NRR e GRR com origem auditável.</p></Card></Link>
      <Link href="/app/saas/retention"><Card className="h-full p-5"><h2 className="font-semibold">Retenção</h2><p className="mt-2 text-sm text-muted-foreground">Entenda por que clientes saem, previna cancelamentos e meça MRR realmente preservado.</p></Card></Link>
      <Link href="/app/assinaturas"><Card className="h-full p-5"><h2 className="font-semibold">Cobrança & contratos</h2><p className="mt-2 text-sm text-muted-foreground">Billing operacional, provedores, cobranças e base financeira existente do CRM.</p></Card></Link>
    </section>
    <Card className="p-5"><h2 className="font-semibold">Como conectar um aplicativo</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Crie um API Token com <code>saas_revenue:write</code> e <code>product_events:write</code>. O app envia assinatura e eventos de uso; o Gravity CRM transforma isso em Customer 360, receita e saúde. Na importação de uma base já existente, envie <code>baseline: true</code> para não transformar clientes antigos em novo MRR.</p></Card>
  </div>;
}
