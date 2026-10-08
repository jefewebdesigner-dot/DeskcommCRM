import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { loadRevenueOverview } from "@/lib/saas/revenue";
export const dynamic="force-dynamic";
const brl=new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:0});
const pct=new Intl.NumberFormat("pt-BR",{style:"percent",maximumFractionDigits:1});
export default async function Revenue(){
 const user=await requireAuth(),org=await resolveActiveOrg(user);if(!org)redirect("/app");if(!user.is_platform_admin&&ROLE_RANK[org.role]<ROLE_RANK.manager)redirect("/403");
 const r=await loadRevenueOverview(org.orgId).catch(()=>null);
 const rows=r?[["MRR atual",r.mrrCents],["Novo MRR",r.newMrrCents],["Expansão",r.expansionMrrCents],["Reativação",r.reactivationMrrCents],["Contração",r.contractionMrrCents],["Churn",r.churnMrrCents]] as const:[];
 return <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5">
  <header><Badge variant="info">Revenue OS</Badge><h1 className="mt-3 text-3xl font-semibold">Receita SaaS</h1><p className="mt-1 text-sm text-muted-foreground">Movimentos de MRR derivados de assinaturas reais; a primeira carga de cada fonte é baseline, não novo MRR inventado.</p></header>
  {!r?<Card className="p-8 text-center text-muted-foreground">Conecte uma fonte de receita para ativar o Revenue OS.</Card>:<>
   <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{rows.map(([l,v])=><Card key={l} className="p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="mt-2 text-xl font-semibold tabular-nums">{brl.format(v/100)}</p></Card>)}</section>
   <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <Card className="p-4"><p className="text-xs text-muted-foreground">ARR</p><p className="mt-2 text-2xl font-semibold">{brl.format(r.arrCents/100)}</p></Card>
    <Card className="p-4"><p className="text-xs text-muted-foreground">ARPU</p><p className="mt-2 text-2xl font-semibold">{brl.format(r.arpuCents/100)}</p></Card>
    <Card className="p-4"><p className="text-xs text-muted-foreground">GRR</p><p className="mt-2 text-2xl font-semibold">{r.grrRate==null?"Histórico em formação":pct.format(r.grrRate)}</p></Card>
    <Card className="p-4"><p className="text-xs text-muted-foreground">NRR</p><p className="mt-2 text-2xl font-semibold">{r.nrrRate==null?"Histórico em formação":pct.format(r.nrrRate)}</p></Card>
   </section>
   {!r.historyComplete?<Card className="p-4 text-sm text-muted-foreground">As taxas comparativas ficam ocultas até existir um mês com baseline anterior ao início da competência. Isso evita mostrar churn/NRR falsos na primeira sincronização.</Card>:null}
  </>}
 </div>;
}
