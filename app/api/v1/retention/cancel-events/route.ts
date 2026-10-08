import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { McpAuthError, ensureScope, validateBearerToken } from "@/lib/mcp/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { CANCEL_OFFER_META, cancelEventRequestSchema, recommendedOfferForReason, type CancelOfferType, type CancelSession } from "@/lib/saas/cancel-flow";

export const dynamic="force-dynamic";

async function syncAction(organizationId:string,session:CancelSession,offerType:CancelOfferType){
  const admin=createAdminClient(),key="cancel-session:"+session.id,offer=CANCEL_OFFER_META[offerType];
  const terminal=["saved","cancelled","abandoned"].includes(session.status);
  if(terminal||offerType==="none"){
    const outcome=session.status==="saved"?"success":offerType==="none"?"not_applicable":"unsuccessful";
    return admin.from("customer_action_items").update({
      status:"done",resolution_outcome:outcome,
      resolution_note:session.status==="saved"?"Oferta aceita e MRR preservado confirmado pelo sistema de origem.":offerType==="none"?"Cancelamento sem oferta de retenção por regra do motivo.":"Cancelamento confirmado pelo sistema de origem.",
      recovered_revenue_cents:session.status==="saved"?Number(session.preserved_mrr_cents):0,
      resolved_at:session.resolved_at??new Date().toISOString(),
    }).eq("organization_id",organizationId).eq("idempotency_key",key);
  }
  return admin.from("customer_action_items").upsert({
    organization_id:organizationId,account_id:session.account_id,
    action_type:offerType==="payment_recovery"?"recover_payment":"prevent_churn",
    priority:offerType==="payment_recovery"?"critical":"high",title:offer.actionTitle,
    evidence:{signals:["Cliente iniciou cancelamento",session.reason?("Motivo confirmado: "+session.reason):"Motivo ainda não informado"],source:"retention_cancel_session",cancel_session_id:session.id,churn_reason:session.reason,playbook_label:offer.label,playbook_steps:offer.steps},
    revenue_impact_cents:Number(session.opening_mrr_cents),idempotency_key:key,status:"open",
  },{onConflict:"organization_id,idempotency_key",ignoreDuplicates:false});
}

export async function POST(req:NextRequest):Promise<Response>{
  const requestId=randomUUID();
  let auth:Awaited<ReturnType<typeof validateBearerToken>>;
  try{auth=await validateBearerToken(req.headers.get("authorization"));ensureScope(auth.scopes,"retention_cancel:write");}
  catch(error){
    if(error instanceof McpAuthError)return fail(error.httpStatus===403?"forbidden":"unauthenticated","Token inválido ou sem permissão.",error.httpStatus,{requestId});
    return fail("internal_error","Não foi possível validar o token.",500,{requestId});
  }
  const rate=await checkRateLimit("retention-cancel:"+auth.apiTokenId,300,60);
  if(!rate.allowed)return fail("rate_limited","Limite de eventos excedido.",429,{requestId,headers:{"Retry-After":String(rate.window_sec)}});

  const parsed=cancelEventRequestSchema.safeParse(await req.json().catch(()=>null));
  if(!parsed.success)return fail("invalid_request","Evento de cancelamento inválido.",400,{requestId,details:parsed.error.flatten()});
  const input=parsed.data,admin=createAdminClient();
  const identity=await admin.from("saas_account_identities").select("account_id")
    .eq("organization_id",auth.organizationId).eq("source",input.source)
    .eq("external_customer_id",input.external_customer_id).maybeSingle();
  if(identity.error)return fail("internal_error","Falha ao resolver a conta SaaS.",500,{requestId});
  if(!identity.data)return fail("not_found","Identidade do cliente não encontrada.",404,{requestId});

  const recommended=input.reason?recommendedOfferForReason(input.reason):null;
  const ing=await admin.rpc("fn_ingest_retention_cancel_event",{
    p_organization_id:auth.organizationId,p_account_id:identity.data.account_id,p_source:input.source,
    p_external_session_id:input.external_session_id,p_external_event_id:input.external_event_id,
    p_event_name:input.event_name,p_occurred_at:input.occurred_at,p_opening_mrr_cents:input.opening_mrr_cents,
    p_reason:input.reason??null,p_reason_detail:input.reason_detail??null,p_competitor_name:input.competitor_name??null,
    p_offer_type:input.offer_type??null,p_recommended_offer_type:recommended,p_preserved_mrr_cents:input.preserved_mrr_cents,
  });
  if(ing.error)return fail("ingestion_failed","Não foi possível registrar o evento de cancelamento.",409,{requestId});
  const result=ing.data as {accepted:boolean;duplicate:boolean;session_id:string;status:CancelSession["status"]};
  const sr=await admin.from("retention_cancel_sessions").select("id,account_id,status,reason,recommended_offer_type,accepted_offer_type,opening_mrr_cents,preserved_mrr_cents,offer_presented_at,resolved_at")
    .eq("organization_id",auth.organizationId).eq("id",result.session_id).single();
  if(sr.error||!sr.data)return fail("internal_error","Evento salvo, mas a sessão não pôde ser consultada.",500,{requestId});
  const session=sr.data as CancelSession,offer=session.recommended_offer_type??"human_review";
  const ar=await syncAction(auth.organizationId,session,offer);
  if(ar.error)return fail("internal_error","Evento salvo, mas o próximo passo não pôde ser sincronizado.",500,{requestId});

  void audit({action:"retention.cancel_event_recorded",actorApiTokenId:auth.apiTokenId,organizationId:auth.organizationId,
    resourceType:"retention_cancel_session",resourceId:session.id,requestId,bypassedRls:true,
    metadata:{event_name:input.event_name,source:input.source,status:session.status,duplicate:result.duplicate}});
  return ok({accepted:result.accepted,duplicate:result.duplicate,session_id:session.id,status:session.status,
    recommended_offer:session.recommended_offer_type?{type:session.recommended_offer_type,...CANCEL_OFFER_META[session.recommended_offer_type]}:null},
    {status:result.accepted?201:200,requestId});
}
