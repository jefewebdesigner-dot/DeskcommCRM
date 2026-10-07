import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { loadSaaSCustomers } from "@/lib/saas/customer360";
export const dynamic="force-dynamic";
const brl=new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:0});
const band={healthy:["Saudável","success"],attention:["Atenção","warning"],high_risk:["Risco alto","error"],critical:["Crítico","error"],insufficient_data:["Sem dados","neutral"]} as const;
export default async function Health(){
 const user=await requireAuth(),org=await resolveActiveOrg(user);if(!org)redirect("/app");if(!user.is_platform_admin&&ROLE_RANK[org.role]<ROLE_RANK.manager)redirect("/403");
 const items=await loadSaaSCustomers(org.orgId).catch(()=>[]);
 return <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5">
  <header><Badge variant="info">Customer Success</Badge><h1 className="mt-3 text-3xl font-semibold">Saúde da base</h1><p className="mt-1 text-sm text-muted-foreground">Priorize por situação financeira, uso real do produto e impacto de receita.</p></header>
  <div className="grid gap-3">{items.map((x)=>{const b=band[x.healthBand];return <Card key={x.id} className="p-5"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex items-center gap-2"><h2 className="font-semibold">{x.name}</h2><Badge variant={b[1]}>{b[0]}</Badge></div><p className="mt-2 text-sm text-muted-foreground">{x.evidence.join(" · ")}</p></div><div className="flex gap-8 text-sm"><div><p className="text-xs text-muted-foreground">MRR</p><b>{brl.format(x.mrrCents/100)}</b></div><div><p className="text-xs text-muted-foreground">Impacto em risco</p><b>{brl.format(x.mrrAtRiskCents/100)}</b></div><div className="min-w-48"><p className="text-xs text-muted-foreground">Próxima ação</p><b>{x.nextAction||"Acompanhar"}</b></div></div></div></Card>})}
  {!items.length?<Card className="p-8 text-center text-muted-foreground">Conecte receita e eventos do produto para formar o primeiro score.</Card>:null}</div>
 </div>;
}
