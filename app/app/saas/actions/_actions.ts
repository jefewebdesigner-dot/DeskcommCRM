"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveSaaSAction(formData:FormData){
  const id=String(formData.get("id")??"");
  const outcome=String(formData.get("outcome")??"");
  const note=String(formData.get("note")??"").trim().slice(0,1000);
  const amount=Number(String(formData.get("recovered_revenue")??"0").replace(",","."));
  if(!UUID.test(id)||!["success","unsuccessful","not_applicable"].includes(outcome))return;
  if(!Number.isFinite(amount)||amount<0||amount>100000000)return;
  const user=await loadAuthUser();if(!user)return;
  const org=await resolveActiveOrg(user);
  if(!org||(!user.is_platform_admin&&ROLE_RANK[org.role]<ROLE_RANK.manager))return;
  const recovered=outcome==="success"?Math.round(amount*100):0;
  const admin=createAdminClient();
  const {data,error}=await admin.from("customer_action_items").update({
    status:"done",resolution_outcome:outcome,resolution_note:note||null,
    recovered_revenue_cents:recovered,resolved_at:new Date().toISOString(),resolved_by:user.id,
  }).eq("organization_id",org.orgId).eq("id",id).eq("status","open")
    .select("id,account_id,action_type").maybeSingle();
  if(error||!data)return;
  void audit({action:"customer_action.outcome_recorded",actorUserId:user.id,organizationId:org.orgId,
    resourceType:"customer_action_item",resourceId:id,
    metadata:{account_id:data.account_id,action_type:data.action_type,outcome,recovered_revenue_cents:recovered}});
  revalidatePath("/app/saas/actions");revalidatePath("/app/saas");revalidatePath("/app/saas/health");
}

export async function dismissSaaSAction(formData:FormData){
  const id=String(formData.get("id")??"");if(!UUID.test(id))return;
  const user=await loadAuthUser();if(!user)return;
  const org=await resolveActiveOrg(user);
  if(!org||(!user.is_platform_admin&&ROLE_RANK[org.role]<ROLE_RANK.manager))return;
  const admin=createAdminClient();
  const {data,error}=await admin.from("customer_action_items").update({
    status:"dismissed",resolution_outcome:"not_applicable",resolved_at:new Date().toISOString(),resolved_by:user.id,
  }).eq("organization_id",org.orgId).eq("id",id).eq("status","open").select("id,account_id").maybeSingle();
  if(error||!data)return;
  void audit({action:"customer_action.dismissed",actorUserId:user.id,organizationId:org.orgId,
    resourceType:"customer_action_item",resourceId:id,metadata:{account_id:data.account_id}});
  revalidatePath("/app/saas/actions");revalidatePath("/app/saas");
}
