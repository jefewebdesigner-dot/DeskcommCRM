import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { loadSaaSCustomers } from "@/lib/saas/customer360";
export const dynamic="force-dynamic";
const brl=new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:0});
const labels={active:"Ativo",past_due:"Inadimplente",canceling:"Cancelando",churned:"Cancelado",unknown:"Sem status"} as const;
export default async function Customers(){
 const user=await requireAuth(),org=await resolveActiveOrg(user);if(!org)redirect("/app");if(!user.is_platform_admin&&ROLE_RANK[org.role]<ROLE_RANK.manager)redirect("/403");
 const items=await loadSaaSCustomers(org.orgId).catch(()=>[]);
 return <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5">
  <header><Badge variant="info">Customer 360</Badge><h1 className="mt-3 text-3xl font-semibold">Clientes SaaS</h1><p className="mt-1 text-sm text-muted-foreground">Uma conta por cliente, mesmo quando receita e uso chegam de fontes diferentes.</p></header>
  <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="p-4">Cliente</th><th>Status</th><th>MRR</th><th>Risco</th><th>Último uso</th><th>Fontes</th></tr></thead>
  <tbody className="divide-y">{items.map((x)=><tr key={x.id}><td className="p-4 font-medium">{x.name}</td><td>{labels[x.status]}</td><td>{brl.format(x.mrrCents/100)}</td><td>{x.mrrAtRiskCents?brl.format(x.mrrAtRiskCents/100):"—"}</td><td>{x.lastUseAt?new Date(x.lastUseAt).toLocaleDateString("pt-BR"):"Sem telemetria"}</td><td>{x.sources.join(" · ")||"—"}</td></tr>)}
  {!items.length?<tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Nenhuma conta SaaS conectada ainda.</td></tr>:null}</tbody></table></div></Card>
 </div>;
}
