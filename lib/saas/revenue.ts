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

async function resolveAccount(organizationId: string, input: RevenueObservation) {
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

export async function ingestRevenueObservation(organizationId:string,input:RevenueObservation) {
  const admin=createAdminClient(),accountId=await resolveAccount(organizationId,input);
  const prev=await admin.from("revenue_subscription_states").select("status,mrr_cents,last_observed_at")
    .eq("organization_id",organizationId).eq("source",input.source)
    .eq("external_subscription_id",input.external_subscription_id).maybeSingle();
  if(prev.error) throw prev.error;
  const base=await admin.from("revenue_source_baselines").select("baseline_at")
    .eq("organization_id",organizationId).eq("source",input.source).maybeSingle();
  if(base.error) throw base.error;
  const first=!base.data;
  const bs=first
    ? await admin.from("revenue_source_baselines").insert({organization_id:organizationId,source:input.source,baseline_at:input.observed_at,last_observed_at:input.observed_at})
    : await admin.from("revenue_source_baselines").update({last_observed_at:input.observed_at}).eq("organization_id",organizationId).eq("source",input.source);
  if(bs.error) throw bs.error;

  const st=await admin.from("revenue_subscription_states").upsert({
    organization_id:organizationId,account_id:accountId,source:input.source,
    external_subscription_id:input.external_subscription_id,external_customer_id:input.external_customer_id,
    status:input.status,mrr_cents:input.mrr_cents,started_at:input.started_at ?? null,
    ended_at:input.ended_at ?? null,last_observed_at:input.observed_at
  },{onConflict:"organization_id,source,external_subscription_id",ignoreDuplicates:false});
  if(st.error) throw st.error;

  const suppressEvent=first || input.baseline === true;
  const change=suppressEvent?null:classifyMrrChange((prev.data as StoredState|null),input);
  if(!change) return {accountId,baseline:suppressEvent,event:null};
  const ev=await admin.from("revenue_mrr_events").upsert({
    organization_id:organizationId,account_id:accountId,source:input.source,
    external_subscription_id:input.external_subscription_id,external_customer_id:input.external_customer_id,
    event_type:change.type,effective_at:change.at,delta_cents:change.delta,
    previous_mrr_cents:change.previous,current_mrr_cents:change.current,
    idempotency_key:input.source+":"+input.external_event_id
  },{onConflict:"organization_id,idempotency_key",ignoreDuplicates:true}).select("id,event_type,delta_cents").maybeSingle();
  if(ev.error) throw ev.error;
  return {accountId,baseline:false,event:ev.data ?? null};
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
