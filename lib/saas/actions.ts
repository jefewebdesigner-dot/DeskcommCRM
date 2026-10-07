import { createAdminClient } from "@/lib/supabase/admin";
import { loadSaaSCustomers, type SaaSCustomer } from "@/lib/saas/customer360";

export type CustomerAction = {
  id: string;
  account_id: string;
  action_type: "recover_payment" | "prevent_churn" | "link_contact" | "review_reactivation";
  priority: "critical" | "high" | "medium" | "low";
  status: "open" | "done" | "dismissed";
  title: string;
  evidence: Record<string, unknown>;
  revenue_impact_cents: number;
  assigned_to: string | null;
  due_at: string | null;
  resolution_outcome: "success" | "unsuccessful" | "not_applicable" | null;
  recovered_revenue_cents: number;
  created_at: string;
  updated_at: string;
};

function desiredFor(customer:SaaSCustomer){
  const out:Array<{
    key:string;
    action_type:CustomerAction["action_type"];
    priority:CustomerAction["priority"];
    title:string;
    evidence:Record<string,unknown>;
    revenue_impact_cents:number;
  }>=[];
  const signals=[...customer.evidence];
  if(customer.status==="past_due"){
    out.push({
      key:"health:"+customer.id+":recover_payment",
      action_type:"recover_payment",priority:"critical",
      title:"Recuperar pagamento em atraso",
      evidence:{signals,source:"customer_health",health_band:customer.healthBand},
      revenue_impact_cents:customer.mrrAtRiskCents||customer.mrrCents,
    });
  }else if(customer.status==="canceling"){
    out.push({
      key:"health:"+customer.id+":prevent_churn",
      action_type:"prevent_churn",priority:"critical",
      title:"Intervir antes do cancelamento",
      evidence:{signals,source:"customer_health",health_band:customer.healthBand},
      revenue_impact_cents:customer.mrrAtRiskCents||customer.mrrCents,
    });
  }else if(customer.healthBand==="high_risk"){
    out.push({
      key:"health:"+customer.id+":prevent_churn",
      action_type:"prevent_churn",priority:"high",
      title:"Reengajar cliente com queda de uso",
      evidence:{signals,source:"customer_health",health_band:customer.healthBand},
      revenue_impact_cents:customer.mrrCents,
    });
  }
  if(!customer.contactId){
    out.push({
      key:"health:"+customer.id+":link_contact",
      action_type:"link_contact",priority:"medium",
      title:"Vincular conta SaaS ao contato do CRM",
      evidence:{signals:["Conta SaaS sem contato CRM vinculado"],source:"customer_360"},
      revenue_impact_cents:customer.mrrCents,
    });
  }
  if(customer.status==="churned"){
    out.push({
      key:"health:"+customer.id+":review_reactivation",
      action_type:"review_reactivation",priority:"low",
      title:"Revisar possibilidade de reativação",
      evidence:{signals,source:"customer_health"},
      revenue_impact_cents:0,
    });
  }
  return out;
}

export async function syncCustomerActionCenter(organizationId:string){
  const customers=await loadSaaSCustomers(organizationId);
  const desired=customers.flatMap((c)=>desiredFor(c).map((a)=>({customer:c,...a})));
  const admin=createAdminClient();

  for(const item of desired){
    const current=await admin.from("customer_action_items").select("id,status")
      .eq("organization_id",organizationId).eq("idempotency_key",item.key).maybeSingle();
    if(current.error) throw current.error;
    if(!current.data){
      const inserted=await admin.from("customer_action_items").insert({
        organization_id:organizationId,
        account_id:item.customer.id,
        action_type:item.action_type,
        priority:item.priority,
        status:"open",
        title:item.title,
        evidence:item.evidence,
        revenue_impact_cents:item.revenue_impact_cents,
        idempotency_key:item.key,
      });
      if(inserted.error) throw inserted.error;
    }else if(current.data.status==="open"){
      const updated=await admin.from("customer_action_items").update({
        priority:item.priority,title:item.title,evidence:item.evidence,
        revenue_impact_cents:item.revenue_impact_cents,
      }).eq("organization_id",organizationId).eq("id",current.data.id);
      if(updated.error) throw updated.error;
    }
  }

  const activeKeys=new Set(desired.map((x)=>x.key));
  const stale=await admin.from("customer_action_items")
    .select("id,idempotency_key")
    .eq("organization_id",organizationId)
    .eq("status","open")
    .like("idempotency_key","health:%");
  if(stale.error) throw stale.error;
  for(const row of stale.data??[]){
    if(activeKeys.has(String(row.idempotency_key))) continue;
    const u=await admin.from("customer_action_items").update({
      status:"done",
      resolution_outcome:"not_applicable",
      resolution_note:"O sinal que gerou esta ação deixou de existir.",
      resolved_at:new Date().toISOString(),
    }).eq("organization_id",organizationId).eq("id",row.id).eq("status","open");
    if(u.error) throw u.error;
  }
  return customers;
}

export async function loadCustomerActionCenter(organizationId:string){
  const customers=await syncCustomerActionCenter(organizationId);
  const actionsResult=await createAdminClient().from("customer_action_items")
      .select("id,account_id,action_type,priority,status,title,evidence,revenue_impact_cents,assigned_to,due_at,resolution_outcome,recovered_revenue_cents,created_at,updated_at")
      .eq("organization_id",organizationId)
      .eq("status","open")
      .order("revenue_impact_cents",{ascending:false})
      .limit(200);
  if(actionsResult.error) throw actionsResult.error;
  const names=new Map(customers.map((c)=>[c.id,c.name]));
  const rank:Record<CustomerAction["priority"],number>={critical:4,high:3,medium:2,low:1};
  return {
    items:((actionsResult.data??[]) as CustomerAction[]).sort((a,b)=>rank[b.priority]-rank[a.priority]||b.revenue_impact_cents-a.revenue_impact_cents),
    names,
  };
}
