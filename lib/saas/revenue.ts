import { createAdminClient } from "@/lib/supabase/admin";

export type RevenueStatus = "active" | "past_due" | "canceling" | "canceled" | "unknown";
export type MrrEventType = "new" | "expansion" | "contraction" | "reactivation" | "churn";
export type RevenueObservation = {
  external_event_id: string; source: string; external_subscription_id: string;
  external_customer_id: string; customer_name?: string; status: RevenueStatus;
  mrr_cents: number; started_at?: string; ended_at?: string; observed_at: string;
  baseline?: boolean;
};
type StoredState = { status: RevenueStatus; mrr_cents: number; last_observed_at: string };
const recurring = (s: RevenueStatus) => s === "active" || s === "past_due" || s === "canceling";

export function classifyMrrChange(previous: StoredState | null, current: RevenueObservation) {
  const cur = recurring(current.status) ? current.mrr_cents : 0;
  if (!previous) return cur > 0 ? { type:"new" as const, delta:cur, previous:0, current:cur, at:current.started_at ?? current.observed_at } : null;
  const prev = recurring(previous.status) ? Number(previous.mrr_cents) : 0;
  if (prev === 0 && cur > 0) return { type:"reactivation" as const, delta:cur, previous:0, current:cur, at:current.observed_at };
  if (prev > 0 && cur === 0) return { type:"churn" as const, delta:-prev, previous:prev, current:0, at:current.ended_at ?? current.observed_at };
  if (prev > 0 && cur > 0 && prev !== cur) {
    const delta=cur-prev; return { type:(delta>0?"expansion":"contraction") as "expansion"|"contraction", delta, previous:prev, current:cur, at:current.observed_at };
  }
  return null;
}

async function resolveAccount(
  organizationId: string,
  input: RevenueObservation,
  allowCreate = true,
) {
  const admin=createAdminClient();
  const found=await admin.from("saas_account_identities").select("account_id")
    .eq("organization_id",organizationId).eq("source",input.source)
    .eq("external_customer_id",input.external_customer_id).maybeSingle();
  if(found.error) throw found.error;
  if(found.data?.account_id) {
    if(input.customer_name) {
      const u=await admin.from("saas_accounts").update({display_name:input.customer_name})
        .eq("organization_id",organizationId).eq("id",found.data.account_id);
      if(u.error) throw u.error;
    }
    return String(found.data.account_id);
  }
  if(!allowCreate) throw new Error("saas_customer_identity_not_found");
  const a=await admin.from("saas_accounts").insert({
    organization_id:organizationId,
    display_name:input.customer_name ?? ("Cliente "+input.external_customer_id.slice(0,12))
  }).select("id").single();
  if(a.error || !a.data) throw a.error ?? new Error("saas_account_not_created");
  const i=await admin.from("saas_account_identities").insert({
    organization_id:organizationId,account_id:a.data.id,source:input.source,external_customer_id:input.external_customer_id
  });
  if(i.error) throw i.error;
  return String(a.data.id);
}

export async function refreshRevenueSnapshot(organizationId:string, now=new Date()){
  const admin=createAdminClient();
  const month=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));
  const monthIso=month.toISOString();
  const monthKey=monthIso.slice(0,10);
  const [sr,er,br]=await Promise.all([
    admin.from("revenue_subscription_states").select("account_id,status,mrr_cents").eq("organization_id",organizationId),
    admin.from("revenue_mrr_events").select("account_id,event_type,delta_cents").eq("organization_id",organizationId).gte("effective_at",monthIso),
    admin.from("revenue_source_baselines").select("baseline_at").eq("organization_id",organizationId),
  ]);
  if(sr.error||er.error||br.error) throw sr.error||er.error||br.error;
  const states=sr.data??[],events=er.data??[];
  const current=states.filter((x)=>recurring(x.status as RevenueStatus));
  const closing=current.reduce((sum,x)=>sum+Number(x.mrr_cents||0),0);
  const activeCustomers=new Set(current.map((x)=>x.account_id).filter(Boolean)).size;
  const sum=(type:MrrEventType)=>events.filter((x)=>x.event_type===type).reduce((n,x)=>n+Math.abs(Number(x.delta_cents||0)),0);
  const newMrr=sum("new"),expansion=sum("expansion"),reactivation=sum("reactivation"),contraction=sum("contraction"),churn=sum("churn");
  const historyComplete=(br.data??[]).length>0&&(br.data??[]).every((b)=>String(b.baseline_at)<=monthIso);
  const opening=historyComplete?Math.max(0,closing-(newMrr+expansion+reactivation-contraction-churn)):null;
  const churnedCustomers=new Set(events.filter((x)=>x.event_type==="churn").map((x)=>x.account_id).filter(Boolean)).size;
  const nrr=historyComplete&&opening&&opening>0?(opening+expansion+reactivation-contraction-churn)/opening:null;
  const grr=historyComplete&&opening&&opening>0?Math.max(0,opening-contraction-churn)/opening:null;
  const upsert=await admin.from("revenue_monthly_snapshots").upsert({
    organization_id:organizationId,month:monthKey,opening_mrr_cents:opening,
    new_mrr_cents:newMrr,expansion_mrr_cents:expansion,reactivation_mrr_cents:reactivation,
    contraction_mrr_cents:contraction,churn_mrr_cents:churn,closing_mrr_cents:closing,
    active_customers:activeCustomers,churned_customers:churnedCustomers,
    nrr_rate:nrr,grr_rate:grr,history_complete:historyComplete,calculated_at:new Date().toISOString(),
  },{onConflict:"organization_id,month",ignoreDuplicates:false});
  if(upsert.error) throw upsert.error;
}

async function refreshSnapshotWithoutBreakingIngestion(organizationId:string){
  try{await refreshRevenueSnapshot(organizationId);}catch(error){
    console.error("[gravity-crm.revenue] snapshot refresh failed",error);
  }
}

export async function ingestRevenueObservation(
  organizationId:string,
  input:RevenueObservation,
  options:{deferSnapshot?:boolean;requireExistingIdentity?:boolean}={},
) {
  const admin=createAdminClient();
  const accountId=await resolveAccount(
    organizationId,
    input,
    !options.requireExistingIdentity,
  );

  const result=await admin.rpc("fn_ingest_revenue_observation",{
    p_organization_id:organizationId,
    p_account_id:accountId,
    p_source:input.source,
    p_external_event_id:input.external_event_id,
    p_external_subscription_id:input.external_subscription_id,
    p_external_customer_id:input.external_customer_id,
    p_status:input.status,
    p_mrr_cents:input.mrr_cents,
    p_observed_at:input.observed_at,
    p_started_at:input.started_at ?? null,
    p_ended_at:input.ended_at ?? null,
    p_baseline:input.baseline === true,
  });
  if(result.error) throw result.error;

  const payload=(result.data ?? {}) as {
    baseline?: boolean;
    event?: {id:string;event_type:MrrEventType;delta_cents:number} | null;
  };

  if(!options.deferSnapshot){
    await refreshSnapshotWithoutBreakingIngestion(organizationId);
  }

  return {
    accountId,
    baseline:payload.baseline === true,
    event:payload.event ?? null,
  };
}

export async function loadRevenueOverview(organizationId:string,now=new Date()) {
  const admin=createAdminClient(),monthStart=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString();
  const [sr,er,br]=await Promise.all([
    admin.from("revenue_subscription_states").select("account_id,status,mrr_cents").eq("organization_id",organizationId),
    admin.from("revenue_mrr_events").select("event_type,delta_cents").eq("organization_id",organizationId).gte("effective_at",monthStart),
    admin.from("revenue_source_baselines").select("baseline_at").eq("organization_id",organizationId)
  ]);
  if(sr.error) throw sr.error;if(er.error) throw er.error;if(br.error) throw br.error;
  const rr=(sr.data??[]).filter((x)=>recurring(x.status as RevenueStatus));
  const mrrCents=rr.reduce((s,x)=>s+Number(x.mrr_cents||0),0);
  const activeCustomers=new Set(rr.map((x)=>x.account_id).filter(Boolean)).size;
  const mrrAtRiskCents=(sr.data??[]).filter((x)=>x.status==="past_due"||x.status==="canceling").reduce((s,x)=>s+Number(x.mrr_cents||0),0);
  const sum=(type:MrrEventType)=>(er.data??[]).filter((x)=>x.event_type===type).reduce((s,x)=>s+Math.abs(Number(x.delta_cents||0)),0);
  const newMrrCents=sum("new"),expansionMrrCents=sum("expansion"),reactivationMrrCents=sum("reactivation"),contractionMrrCents=sum("contraction"),churnMrrCents=sum("churn");
  const opening=Math.max(0,mrrCents-(newMrrCents+expansionMrrCents+reactivationMrrCents-contractionMrrCents-churnMrrCents));
  const historyComplete=(br.data??[]).length>0&&(br.data??[]).every((b)=>String(b.baseline_at)<=monthStart);
  return {
    mrrCents,arrCents:mrrCents*12,activeCustomers,arpuCents:activeCustomers?Math.round(mrrCents/activeCustomers):0,mrrAtRiskCents,
    newMrrCents,expansionMrrCents,reactivationMrrCents,contractionMrrCents,churnMrrCents,historyComplete,
    nrrRate:historyComplete&&opening>0?(opening+expansionMrrCents+reactivationMrrCents-contractionMrrCents-churnMrrCents)/opening:null,
    grrRate:historyComplete&&opening>0?Math.max(0,opening-contractionMrrCents-churnMrrCents)/opening:null
  };
}
