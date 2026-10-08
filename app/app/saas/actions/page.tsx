import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { loadCustomerActionCenter } from "@/lib/saas/actions";
import { dismissSaaSAction, resolveSaaSAction } from "./_actions";

export const dynamic="force-dynamic";
const brl=new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:0});
const meta={
  critical:{label:"Crítico",variant:"error"},
  high:{label:"Alta",variant:"warning"},
  medium:{label:"Média",variant:"info"},
  low:{label:"Baixa",variant:"neutral"},
} as const;

export default async function SaaSActions(){
  const user=await requireAuth(),org=await resolveActiveOrg(user);
  if(!org)redirect("/app");
  if(!user.is_platform_admin&&ROLE_RANK[org.role]<ROLE_RANK.manager)redirect("/403");
  const data=await loadCustomerActionCenter(org.orgId).catch(()=>({items:[],names:new Map<string,string>()}));
  return <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5">
    <header><Badge variant="info">Customer Success</Badge><h1 className="mt-3 text-3xl font-semibold">Action Center</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Próximas ações derivadas de cobrança, intenção de cancelamento, uso do produto e vínculo do cliente.</p></header>
    <div className="grid gap-3">
      {data.items.map((item)=>{const p=meta[item.priority];const signals=Array.isArray((item.evidence as any)?.signals)?(item.evidence as any).signals:[];return <Card key={item.id} className="p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge variant={p.variant}>{p.label}</Badge><span className="text-sm font-semibold">{data.names.get(item.account_id)||"Cliente SaaS"}</span></div>
            <h2 className="mt-2 text-lg font-semibold">{item.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{signals.join(" · ")||"Ação gerada a partir dos sinais atuais do cliente."}</p>
            {item.revenue_impact_cents>0?<p className="mt-2 text-xs text-muted-foreground">Receita em jogo: <b className="text-foreground">{brl.format(item.revenue_impact_cents/100)}</b></p>:null}
          </div>
          <form action={resolveSaaSAction} className="grid min-w-[300px] gap-2 sm:grid-cols-[1fr_120px_auto]">
            <input type="hidden" name="id" value={item.id}/>
            <select name="outcome" defaultValue="success" className="h-9 rounded-md border border-border bg-background px-3 text-sm">
              <option value="success">Sucesso</option><option value="unsuccessful">Sem sucesso</option><option value="not_applicable">Não se aplica</option>
            </select>
            <Input name="recovered_revenue" inputMode="decimal" placeholder="R$ recuperado"/>
            <Button type="submit" size="sm">Concluir</Button>
            <Input name="note" className="sm:col-span-2" placeholder="Observação opcional"/>
            <Button formAction={dismissSaaSAction} type="submit" variant="ghost" size="sm">Ignorar</Button>
          </form>
        </div>
      </Card>})}
      {!data.items.length?<Card className="p-8 text-center text-muted-foreground">Nenhuma ação prioritária aberta agora.</Card>:null}
    </div>
  </div>;
}
