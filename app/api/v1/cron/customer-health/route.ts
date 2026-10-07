import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { syncCustomerActionCenter } from "@/lib/saas/actions";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic="force-dynamic";
const ORG_LIMIT=250;

async function handle(req:NextRequest):Promise<Response>{
  const requestId=randomUUID();
  if(!autorizaCron(req))return fail("forbidden","Cron secret missing or invalid.",403,{requestId});
  const admin=createAdminClient();
  const listed=await admin.from("saas_accounts").select("organization_id").limit(5000);
  if(listed.error)return fail("internal_error","Failed to list SaaS organizations.",500,{requestId});
  const orgs=[...new Set((listed.data??[]).map((x)=>String(x.organization_id)))].slice(0,ORG_LIMIT);
  let created=0,updated=0,autoClosed=0,failed=0;
  for(const organizationId of orgs){
    try{
      const result=await syncCustomerActionCenter(organizationId);
      created+=result.created;updated+=result.updated;autoClosed+=result.autoClosed;
    }catch(error){
      failed++;
      console.error("[customer-health-cron] reconcile failed",{organizationId,error});
    }
  }
  if(created||autoClosed){
    void audit({
      action:"customer_health.reconciled",
      organizationId:null,
      bypassedRls:true,
      requestId,
      metadata:{organizations:orgs.length,created,updated,auto_closed:autoClosed,failed},
    });
  }
  return ok({organizations:orgs.length,created,updated,auto_closed:autoClosed,failed},{requestId});
}
export async function GET(req:NextRequest){return handle(req);}
export async function POST(req:NextRequest){return handle(req);}
