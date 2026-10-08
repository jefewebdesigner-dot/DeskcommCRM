import { createAdminClient } from "@/lib/supabase/admin";

export const CHURN_REASON_KEYS=[
  "price","low_usage","missing_feature","competitor",
  "technical_issue","delinquency","business_closed","other",
] as const;
export type ChurnReason=(typeof CHURN_REASON_KEYS)[number];

export const CHURN_REASON_META:Record<ChurnReason,{label:string;recommendation:string}>={
  price:{label:"Preço",recommendation:"Revisar plano, valor percebido ou condição temporária."},
  low_usage:{label:"Baixo uso",recommendation:"Recuperar ativação e hábito de uso antes de oferecer desconto."},
  missing_feature:{label:"Recurso ausente",recommendation:"Validar impacto e oferecer alternativa ou prazo realista."},
  competitor:{label:"Concorrente",recommendation:"Identificar a diferença decisiva e revisar posicionamento."},
  technical_issue:{label:"Problema técnico",recommendation:"Escalar correção e comunicar acompanhamento."},
  delinquency:{label:"Inadimplência",recommendation:"Executar recuperação de pagamento sem tratar como churn voluntário."},
  business_closed:{label:"Empresa encerrada",recommendation:"Registrar perda inevitável e não insistir em retenção."},
  other:{label:"Outro",recommendation:"Investigar a causa antes de automatizar qualquer oferta."},
};

export type ChurnPlaybook={
  actionType:"recover_payment"|"review_reactivation";
  priority:"critical"|"high"|"medium"|"low";
  title:string;label:string;steps:string[];createsAction:boolean;
};
const PLAYBOOKS:Record<ChurnReason,ChurnPlaybook>={
  price:{actionType:"review_reactivation",priority:"high",title:"Reativar cliente com ajuste de plano",label:"Adequação de plano e valor",steps:["Confirmar se preço ou valor percebido determinou a saída.","Revisar plano menor ou condição temporária sem comprometer margem.","Registrar resposta antes de considerar recuperação."],createsAction:true},
  low_usage:{actionType:"review_reactivation",priority:"high",title:"Reativar cliente com onboarding orientado",label:"Retomada de adoção",steps:["Identificar o marco de valor não alcançado.","Oferecer onboarding objetivo.","Confirmar retomada por evidência de uso."],createsAction:true},
  missing_feature:{actionType:"review_reactivation",priority:"medium",title:"Revisar churn por recurso ausente",label:"Lacuna de produto",steps:["Documentar caso de uso e impacto.","Validar alternativa existente ou prazo realista.","Reabrir conversa somente quando houver solução aderente."],createsAction:true},
  competitor:{actionType:"review_reactivation",priority:"high",title:"Revisar perda para concorrente",label:"Resposta competitiva",steps:["Identificar diferença decisiva.","Comparar aderência e custo total.","Registrar objeção para posicionamento e produto."],createsAction:true},
  technical_issue:{actionType:"review_reactivation",priority:"critical",title:"Escalar churn por problema técnico",label:"Recuperação técnica",steps:["Registrar problema reproduzível.","Escalar correção e manter cliente informado.","Propor reativação após confirmar solução."],createsAction:true},
  delinquency:{actionType:"recover_payment",priority:"critical",title:"Recuperar churn por inadimplência",label:"Recuperação de pagamento",steps:["Confirmar falha e tentativas.","Oferecer forma segura de regularização.","Registrar receita recuperada após compensação."],createsAction:true},
  business_closed:{actionType:"review_reactivation",priority:"low",title:"Registrar encerramento da empresa",label:"Perda inevitável",steps:["Confirmar encerramento.","Preservar aprendizado.","Encerrar ação como não aplicável."],createsAction:false},
  other:{actionType:"review_reactivation",priority:"medium",title:"Investigar motivo adicional de churn",label:"Diagnóstico complementar",steps:["Revisar detalhe registrado.","Confirmar causa principal.","Definir ação compatível sem presumir oferta."],createsAction:true},
};
export const playbookForChurnReason=(reason:ChurnReason)=>PLAYBOOKS[reason];

type Snapshot={month:string;opening_mrr_cents:number|null;contraction_mrr_cents:number;churn_mrr_cents:number;active_customers:number;churned_customers:number;nrr_rate:number|null;grr_rate:number|null;history_complete:boolean};
type Event={id:string;account_id:string|null;source:string;event_type:string;effective_at:string;delta_cents:number};
type Diagnosis={revenue_mrr_event_id:string;reason:string;reason_detail:string|null;competitor_name:string|null};
export type RetentionMovement={id:string;accountId:string|null;customer:string;source:string;type:"churn"|"contraction";amountCents:number;effectiveAt:string;reason:ChurnReason|null;reasonDetail:string|null;competitorName:string|null};

export async function loadRetentionIntelligence(organizationId:string){
  const admin=createAdminClient();
  const [snap,events,diagnoses,accounts]=await Promise.all([
    admin.from("revenue_monthly_snapshots").select("month,opening_mrr_cents,contraction_mrr_cents,churn_mrr_cents,active_customers,churned_customers,nrr_rate,grr_rate,history_complete").eq("organization_id",organizationId).order("month",{ascending:false}).limit(2),
    admin.from("revenue_mrr_events").select("id,account_id,source,event_type,effective_at,delta_cents").eq("organization_id",organizationId).in("event_type",["churn","contraction"]).order("effective_at",{ascending:false}).limit(500),
    admin.from("retention_churn_diagnoses").select("revenue_mrr_event_id,reason,reason_detail,competitor_name").eq("organization_id",organizationId),
    admin.from("saas_accounts").select("id,display_name").eq("organization_id",organizationId),
  ]);
  if(snap.error)throw snap.error;if(events.error)throw events.error;if(diagnoses.error)throw diagnoses.error;if(accounts.error)throw accounts.error;
  const snapshots=(snap.data??[]) as Snapshot[],latest=snapshots[0]??null,previous=snapshots[1]??null;
  const names=new Map((accounts.data??[]).map((a)=>[String(a.id),String(a.display_name||"Cliente SaaS")]));
  const diag=new Map((diagnoses.data??[]).map((d)=>[String(d.revenue_mrr_event_id),d as Diagnosis]));
  const movements=((events.data??[]) as Event[]).map((e)=>{
    const d=diag.get(e.id);
    const reason=d&&CHURN_REASON_KEYS.includes(d.reason as ChurnReason)?d.reason as ChurnReason:null;
    return {id:e.id,accountId:e.account_id,customer:e.account_id?(names.get(e.account_id)||"Cliente SaaS"):"Vínculo pendente",source:e.source,type:e.event_type as "churn"|"contraction",amountCents:Math.abs(Number(e.delta_cents)),effectiveAt:e.effective_at,reason,reasonDetail:d?.reason_detail??null,competitorName:d?.competitor_name??null};
  });
  const currentPeriod=latest?.month.slice(0,7)??new Date().toISOString().slice(0,7);
  const periodChurn=movements.filter((m)=>m.type==="churn"&&m.effectiveAt.slice(0,7)===currentPeriod);
  const classified=periodChurn.filter((m):m is RetentionMovement&{reason:ChurnReason}=>m.reason!==null);
  const byReason=CHURN_REASON_KEYS.flatMap((reason)=>{
    const rows=classified.filter((m)=>m.reason===reason);if(!rows.length)return[];
    const mrrCents=rows.reduce((n,r)=>n+r.amountCents,0);
    return [{reason,label:CHURN_REASON_META[reason].label,customers:new Set(rows.map((r)=>r.accountId??r.id)).size,mrrCents,recommendation:CHURN_REASON_META[reason].recommendation}];
  }).sort((a,b)=>b.mrrCents-a.mrrCents);
  const openingCustomers=latest?latest.active_customers+latest.churned_customers:0;
  return {
    latest,previous,movements:movements.slice(0,12),reasons:byReason,
    unclassified:periodChurn.filter((m)=>!m.reason).slice(0,8),
    reasonCoverage:periodChurn.length?classified.length/periodChurn.length:0,
    customerChurnRate:latest?.history_complete&&openingCustomers>0?latest.churned_customers/openingCustomers:null,
    grossMrrChurnRate:latest?.history_complete&&(latest.opening_mrr_cents??0)>0?(latest.churn_mrr_cents+latest.contraction_mrr_cents)/latest.opening_mrr_cents!:null,
  };
}
