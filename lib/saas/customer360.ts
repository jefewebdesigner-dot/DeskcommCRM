import { createAdminClient } from "@/lib/supabase/admin";
export type HealthBand="healthy"|"attention"|"high_risk"|"critical"|"insufficient_data";
export type SaaSCustomer={
  id:string;name:string;contactId:string|null;sources:string[];
  status:"active"|"past_due"|"canceling"|"churned"|"unknown";
  mrrCents:number;mrrAtRiskCents:number;lastUseAt:string|null;totalEvents:number;
  healthScore:number|null;healthBand:HealthBand;evidence:string[];nextAction:string|null;
};
export function classifyHealth(input:{status:SaaSCustomer["status"];lastUseAt:string|null;totalEvents:number},now=new Date()){
  if(input.status==="past_due")return{score:15,band:"critical" as const,evidence:["Pagamento em atraso"],nextAction:"Recuperar pagamento"};
  if(input.status==="canceling")return{score:35,band:"high_risk" as const,evidence:["Cancelamento em andamento"],nextAction:"Intervir antes do cancelamento"};
  if(input.status==="churned")return{score:null,band:"insufficient_data" as const,evidence:["Cliente cancelado"],nextAction:"Avaliar reativação quando houver aderência"};
  if(!input.lastUseAt||input.totalEvents<=0)return{score:null,band:"insufficient_data" as const,evidence:["Uso do produto ainda não conectado"],nextAction:null};
  const days=Math.max(0,Math.floor((now.getTime()-new Date(input.lastUseAt).getTime())/86400000));
  if(days<=14)return{score:90,band:"healthy" as const,evidence:["Uso confirmado há "+days+" dia(s)","Situação financeira sem alerta"],nextAction:null};
  if(days<=30)return{score:65,band:"attention" as const,evidence:["Último uso há "+days+" dias"],nextAction:"Entender queda de uso"};
  return{score:40,band:"high_risk" as const,evidence:["Sem uso confirmado há "+days+" dias"],nextAction:"Reengajar cliente"};
}
export async function loadSaaSCustomers(organizationId:string):Promise<SaaSCustomer[]>{
  const a=createAdminClient();
  const [ar,ir,sr,ur]=await Promise.all([
    a.from("saas_accounts").select("id,contact_id,display_name").eq("organization_id",organizationId),
    a.from("saas_account_identities").select("account_id,source,external_customer_id").eq("organization_id",organizationId),
    a.from("revenue_subscription_states").select("account_id,status,mrr_cents").eq("organization_id",organizationId),
    a.from("product_usage_states").select("account_id,last_event_at,total_events").eq("organization_id",organizationId)
  ]);
  if(ar.error)throw ar.error;if(ir.error)throw ir.error;if(sr.error)throw sr.error;if(ur.error)throw ur.error;
  const usage=new Map((ur.data??[]).map((u)=>[String(u.account_id),u]));
  return (ar.data??[]).map((account)=>{
    const id=String(account.id),ids=(ir.data??[]).filter((x)=>String(x.account_id)===id),subs=(sr.data??[]).filter((x)=>String(x.account_id)===id);
    const statuses=new Set(subs.map((x)=>String(x.status)));
    const status:SaaSCustomer["status"]=statuses.has("past_due")?"past_due":statuses.has("canceling")?"canceling":statuses.has("active")?"active":statuses.has("canceled")?"churned":"unknown";
    const mrrCents=subs.filter((x)=>["active","past_due","canceling"].includes(String(x.status))).reduce((s,x)=>s+Number(x.mrr_cents||0),0);
    const mrrAtRiskCents=subs.filter((x)=>["past_due","canceling"].includes(String(x.status))).reduce((s,x)=>s+Number(x.mrr_cents||0),0);
    const u=usage.get(id),h=classifyHealth({status,lastUseAt:u?.last_event_at?String(u.last_event_at):null,totalEvents:Number(u?.total_events||0)});
    return{id,name:String(account.display_name||(ids[0]?.external_customer_id?("Cliente "+String(ids[0].external_customer_id).slice(0,12)):"Cliente SaaS")),contactId:account.contact_id?String(account.contact_id):null,
      sources:[...new Set(ids.map((x)=>String(x.source)))],status,mrrCents,mrrAtRiskCents,lastUseAt:u?.last_event_at?String(u.last_event_at):null,totalEvents:Number(u?.total_events||0),
      healthScore:h.score,healthBand:h.band,evidence:h.evidence,nextAction:h.nextAction};
  }).sort((a,b)=>Number(["critical","high_risk"].includes(b.healthBand))-Number(["critical","high_risk"].includes(a.healthBand))||b.mrrAtRiskCents-a.mrrAtRiskCents||b.mrrCents-a.mrrCents);
}
