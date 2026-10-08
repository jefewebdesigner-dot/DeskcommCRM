import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { loadCancelFlowMetrics } from "@/lib/saas/cancel-flow";
import { CHURN_REASON_KEYS, CHURN_REASON_META, loadRetentionIntelligence } from "@/lib/saas/retention";
import { classifyChurnReason } from "./_actions";

export const dynamic="force-dynamic";
const brl=new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:0});
const pct=new Intl.NumberFormat("pt-BR",{style:"percent",maximumFractionDigits:1});

export default async function RetentionPage(){
  const user=await requireAuth(),org=await resolveActiveOrg(user);
  if(!org)redirect("/app");if(!user.is_platform_admin&&ROLE_RANK[org.role]<ROLE_RANK.manager)redirect("/403");
  const [data,cancel]=await Promise.all([
    loadRetentionIntelligence(org.orgId).catch(()=>null),
    loadCancelFlowMetrics(org.orgId).catch(()=>null),
  ]);
  const latest=data?.latest;
  return <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><Badge variant="info">Retention Intelligence</Badge><h1 className="mt-3 text-3xl font-semibold">Retenção</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Transforma churn em causa registrada, playbook e ação operacional — sem esconder cancelamento do cliente.</p></div>
      <Button asChild variant="outline"><Link href="/app/saas/actions">Abrir Action Center</Link></Button>
    </header>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {[
        ["Churn de clientes",data?.customerChurnRate==null?"Histórico em formação":pct.format(data.customerChurnRate)],
        ["Churn bruto MRR",data?.grossMrrChurnRate==null?"Histórico em formação":pct.format(data.grossMrrChurnRate)],
        ["GRR",latest?.grr_rate==null?"—":pct.format(latest.grr_rate)],
        ["NRR",latest?.nrr_rate==null?"—":pct.format(latest.nrr_rate)],
        ["Cobertura de motivo",data?pct.format(data.reasonCoverage):"—"],
      ].map(([l,v])=><Card key={l} className="p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="mt-2 text-xl font-semibold">{v}</p></Card>)}
    </section>
    <Card className="p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Prevenção antes do cancelamento</h2><p className="mt-1 text-sm text-muted-foreground">O aplicativo informa intenção, motivo, oferta e desfecho real.</p></div><Badge variant={cancel?.trackingStarted?"success":"neutral"}>{cancel?.trackingStarted?"Mensuração ativa":"Aguardando integração"}</Badge></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div><p className="text-xs text-muted-foreground">Intenções</p><b className="text-xl">{cancel?.sessions??0}</b></div>
        <div><p className="text-xs text-muted-foreground">Salvos</p><b className="text-xl">{cancel?.savedCustomers??0}</b></div>
        <div><p className="text-xs text-muted-foreground">Taxa de salvamento</p><b className="text-xl">{cancel?.saveRate==null?"—":pct.format(cancel.saveRate)}</b></div>
        <div><p className="text-xs text-muted-foreground">MRR preservado</p><b className="text-xl">{brl.format((cancel?.preservedMrrCents??0)/100)}</b></div>
      </div>
      {!cancel?.trackingStarted?<p className="mt-4 text-xs text-muted-foreground">Conecte o app em <code>/api/v1/retention/cancel-events</code> usando o escopo <code>retention_cancel:write</code>.</p>:null}
    </Card>
    <section className="grid gap-4 xl:grid-cols-[2fr_1fr]">
      <Card className="overflow-hidden"><div className="border-b p-5"><h2 className="font-semibold">Perdas recentes</h2><p className="mt-1 text-xs text-muted-foreground">Churn e contração vindos do ledger de MRR.</p></div>
        <div className="divide-y">{(data?.movements??[]).map((m)=><div key={m.id} className="p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><b>{m.customer}</b><p className="text-xs text-muted-foreground">{m.type==="churn"?"Cancelamento":"Contração"} · {new Date(m.effectiveAt).toLocaleDateString("pt-BR")}</p></div><b>{brl.format(m.amountCents/100)}</b></div>
          {m.reason?<p className="mt-2 text-sm text-muted-foreground">Motivo: <b className="text-foreground">{CHURN_REASON_META[m.reason].label}</b></p>:m.type==="churn"?<form action={classifyChurnReason} className="mt-3 grid gap-2 sm:grid-cols-[160px_1fr_1fr_auto]"><input type="hidden" name="event_id" value={m.id}/><select name="reason" className="h-9 rounded-md border border-border bg-background px-3 text-sm">{CHURN_REASON_KEYS.map((r)=><option key={r} value={r}>{CHURN_REASON_META[r].label}</option>)}</select><Input name="reason_detail" placeholder="Detalhe opcional"/><Input name="competitor_name" placeholder="Concorrente, se houver"/><Button size="sm" type="submit">Registrar causa</Button></form>:null}
        </div>)}{!data?.movements.length?<div className="p-8 text-center text-muted-foreground">Nenhuma perda registrada ainda.</div>:null}</div>
      </Card>
      <Card className="p-5"><h2 className="font-semibold">Principais causas</h2><div className="mt-4 space-y-4">{(data?.reasons??[]).map((r)=><div key={r.reason}><div className="flex justify-between gap-3"><span className="text-sm font-medium">{r.label}</span><b className="text-sm">{brl.format(r.mrrCents/100)}</b></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{r.recommendation}</p></div>)}{!data?.reasons.length?<p className="text-sm text-muted-foreground">Registre os primeiros motivos para formar o diagnóstico.</p>:null}</div></Card>
    </section>
  </div>;
}
