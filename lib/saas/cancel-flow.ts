import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChurnReason } from "@/lib/saas/retention";

export const CANCEL_EVENT_NAMES=["cancel_intent_created","cancel_reason_selected","cancel_offer_presented","cancel_offer_accepted","cancellation_confirmed","cancel_session_abandoned"] as const;
export const CANCEL_OFFER_TYPES=["downgrade","pause","onboarding","roadmap","competitive_review","priority_support","payment_recovery","human_review","none"] as const;
export type CancelOfferType=(typeof CANCEL_OFFER_TYPES)[number];

export const CANCEL_OFFER_META:Record<CancelOfferType,{label:string;actionTitle:string;steps:string[]}>={
  downgrade:{label:"Adequar o plano",actionTitle:"Avaliar plano compatível antes do cancelamento",steps:["Entender limite de orçamento.","Apresentar um plano já configurado.","Confirmar novo MRR após aceite."]},
  pause:{label:"Pausar temporariamente",actionTitle:"Avaliar pausa com data de retorno",steps:["Confirmar necessidade temporária.","Definir retorno.","Preservar dados e contexto."]},
  onboarding:{label:"Apoio de ativação",actionTitle:"Recuperar valor percebido com onboarding",steps:["Identificar etapa de ativação ausente.","Agendar acompanhamento objetivo.","Medir retomada de uso."]},
  roadmap:{label:"Roadmap ou alternativa",actionTitle:"Validar solução para funcionalidade ausente",steps:["Confirmar funcionalidade necessária.","Apresentar alternativa real ou prazo aprovado.","Não prometer entrega sem validação."]},
  competitive_review:{label:"Revisão competitiva",actionTitle:"Entender a troca por concorrente",steps:["Registrar concorrente e critério decisivo.","Comparar apenas capacidades confirmadas.","Escalar oportunidade de produto."]},
  priority_support:{label:"Suporte prioritário",actionTitle:"Resolver bloqueio técnico antes do churn",steps:["Reproduzir bloqueio.","Definir responsável e prazo.","Confirmar resolução com cliente."]},
  payment_recovery:{label:"Recuperação de pagamento",actionTitle:"Regularizar pagamento antes do cancelamento",steps:["Identificar falha financeira.","Oferecer atualização segura.","Confirmar pagamento."]},
  human_review:{label:"Revisão humana",actionTitle:"Investigar intenção de cancelamento",steps:["Ler detalhe informado.","Confirmar causa principal.","Definir intervenção sem presumir oferta."]},
  none:{label:"Sem oferta",actionTitle:"Concluir cancelamento com respeito",steps:["Não criar fricção.","Confirmar efeitos do encerramento.","Preservar aprendizado."]},
};
const byReason:Record<ChurnReason,CancelOfferType>={price:"downgrade",low_usage:"onboarding",missing_feature:"roadmap",competitor:"competitive_review",technical_issue:"priority_support",delinquency:"payment_recovery",business_closed:"none",other:"human_review"};
export const recommendedOfferForReason=(r:ChurnReason)=>byReason[r];

const reason=z.enum(["price","low_usage","missing_feature","competitor","technical_issue","delinquency","business_closed","other"]);
export const cancelEventRequestSchema=z.object({
  external_event_id:z.string().min(1).max(200),external_session_id:z.string().min(1).max(200),
  source:z.string().regex(/^[a-z][a-z0-9_-]{1,49}$/),external_customer_id:z.string().min(1).max(200),
  event_name:z.enum(CANCEL_EVENT_NAMES),occurred_at:z.iso.datetime({offset:true}),
  opening_mrr_cents:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  reason:reason.optional(),reason_detail:z.string().trim().max(1000).optional(),competitor_name:z.string().trim().max(120).optional(),
  offer_type:z.enum(CANCEL_OFFER_TYPES).optional(),preserved_mrr_cents:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
}).superRefine((v,ctx)=>{
  if(v.event_name==="cancel_reason_selected"&&!v.reason)ctx.addIssue({code:"custom",path:["reason"],message:"Motivo obrigatório."});
  if(v.reason==="competitor"&&!v.competitor_name)ctx.addIssue({code:"custom",path:["competitor_name"],message:"Concorrente obrigatório."});
  if(["cancel_offer_presented","cancel_offer_accepted"].includes(v.event_name)&&!v.offer_type)ctx.addIssue({code:"custom",path:["offer_type"],message:"Oferta obrigatória."});
  if(v.event_name==="cancel_offer_accepted"&&v.preserved_mrr_cents<=0)ctx.addIssue({code:"custom",path:["preserved_mrr_cents"],message:"Informe o MRR preservado."});
});

export type CancelSession={id:string;account_id:string;status:"open"|"offer_presented"|"saved"|"cancelled"|"abandoned";reason:ChurnReason|null;recommended_offer_type:CancelOfferType|null;accepted_offer_type:CancelOfferType|null;opening_mrr_cents:number;preserved_mrr_cents:number;offer_presented_at?:string|null;resolved_at?:string|null};
export function summarizeCancelFlow(rows:CancelSession[]){
  const saved=rows.filter((r)=>r.status==="saved"),cancelled=rows.filter((r)=>r.status==="cancelled"),resolved=saved.length+cancelled.length;
  const offered=rows.filter((r)=>Boolean(r.offer_presented_at)||r.status==="saved").length;
  return {trackingStarted:rows.length>0,sessions:rows.length,offersPresented:offered,savedCustomers:saved.length,cancelledCustomers:cancelled.length,openSessions:rows.filter((r)=>r.status==="open"||r.status==="offer_presented").length,saveRate:resolved?saved.length/resolved:null,offerAcceptanceRate:offered?saved.length/offered:null,preservedMrrCents:saved.reduce((n,r)=>n+Number(r.preserved_mrr_cents),0)};
}
export async function loadCancelFlowMetrics(organizationId:string){
  const since=new Date(Date.now()-30*86400000).toISOString();
  const r=await createAdminClient().from("retention_cancel_sessions").select("id,account_id,status,reason,recommended_offer_type,accepted_offer_type,opening_mrr_cents,preserved_mrr_cents,offer_presented_at,resolved_at").eq("organization_id",organizationId).gte("started_at",since).order("started_at",{ascending:false}).limit(2000);
  if(r.error)throw r.error;return summarizeCancelFlow((r.data??[]) as CancelSession[]);
}
