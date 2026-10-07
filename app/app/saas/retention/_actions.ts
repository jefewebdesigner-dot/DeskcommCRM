"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { CHURN_REASON_KEYS, CHURN_REASON_META, playbookForChurnReason } from "@/lib/saas/retention";

const schema=z.object({
  eventId:z.string().uuid(),reason:z.enum(CHURN_REASON_KEYS),
  reasonDetail:z.string().trim().max(1000).optional(),competitorName:z.string().trim().max(120).optional(),
}).refine((v)=>v.reason!=="competitor"||Boolean(v.competitorName),{message:"Informe o concorrente.",path:["competitorName"]});

export async function classifyChurnReason(formData:FormData){
  const parsed=schema.safeParse({
    eventId:String(formData.get("event_id")??""),reason:String(formData.get("reason")??""),
    reasonDetail:String(formData.get("reason_detail")??"")||undefined,
    competitorName:String(formData.get("competitor_name")??"")||undefined,
  });
  if(!parsed.success)return;
  const user=await loadAuthUser();if(!user)return;
  const org=await resolveActiveOrg(user);if(!org||(!user.is_platform_admin&&ROLE_RANK[org.role]<ROLE_RANK.manager))return;
  const admin=createAdminClient();
  const er=await admin.from("revenue_mrr_events").select("id,account_id,event_type,delta_cents")
    .eq("id",parsed.data.eventId).eq("organization_id",org.orgId).eq("event_type","churn").maybeSingle();
  if(er.error||!er.data)return;
  const dr=await admin.from("retention_churn_diagnoses").upsert({
    organization_id:org.orgId,account_id:er.data.account_id,revenue_mrr_event_id:er.data.id,
    reason:parsed.data.reason,reason_detail:parsed.data.reasonDetail||null,
    competitor_name:parsed.data.reason==="competitor"?parsed.data.competitorName||null:null,captured_by:user.id,
  },{onConflict:"organization_id,revenue_mrr_event_id"}).select("id").single();
  if(dr.error||!dr.data)return;
  void audit({action:"retention.churn_reason_recorded",actorUserId:user.id,organizationId:org.orgId,
    resourceType:"retention_churn_diagnosis",resourceId:dr.data.id,
    metadata:{revenue_mrr_event_id:er.data.id,account_id:er.data.account_id,reason:parsed.data.reason}});
  const playbook=playbookForChurnReason(parsed.data.reason),key="churn:"+er.data.id;
  if(er.data.account_id&&playbook.createsAction){
    const ar=await admin.from("customer_action_items").upsert({
      organization_id:org.orgId,account_id:er.data.account_id,action_type:playbook.actionType,
      priority:playbook.priority,title:playbook.title,
      evidence:{signals:["Motivo confirmado: "+CHURN_REASON_META[parsed.data.reason].label,parsed.data.reasonDetail||null].filter(Boolean),source:"retention_churn_diagnosis",churn_reason:parsed.data.reason,diagnosis_id:dr.data.id,playbook_label:playbook.label,playbook_steps:playbook.steps},
      revenue_impact_cents:Math.abs(Number(er.data.delta_cents)),idempotency_key:key,status:"open",
    },{onConflict:"organization_id,idempotency_key",ignoreDuplicates:false}).select("id").single();
    if(!ar.error&&ar.data)void audit({action:"retention.playbook_synced",actorUserId:user.id,organizationId:org.orgId,
      resourceType:"customer_action_item",resourceId:ar.data.id,metadata:{revenue_mrr_event_id:er.data.id,reason:parsed.data.reason}});
  }
  revalidatePath("/app/saas/retention");revalidatePath("/app/saas/actions");revalidatePath("/app/saas");
}
