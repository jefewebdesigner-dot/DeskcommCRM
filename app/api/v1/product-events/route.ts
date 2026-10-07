import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { McpAuthError, ensureScope, validateBearerToken } from "@/lib/mcp/auth";
import { productEventsRequestSchema } from "@/lib/schemas/product-events";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(req:NextRequest):Promise<Response>{
  const requestId=randomUUID();
  let auth:Awaited<ReturnType<typeof validateBearerToken>>;
  try{auth=await validateBearerToken(req.headers.get("authorization"));ensureScope(auth.scopes,"product_events:write");}
  catch(error){
    if(error instanceof McpAuthError)return fail(error.httpStatus===403?"forbidden":"unauthenticated","Token inválido ou sem permissão.",error.httpStatus,{requestId});
    return fail("internal_error","Não foi possível validar o token.",500,{requestId});
  }
  const rate=await checkRateLimit("product-events:"+auth.apiTokenId,600,60);
  if(!rate.allowed)return fail("rate_limited","Limite de eventos excedido.",429,{requestId,headers:{"Retry-After":String(rate.window_sec)}});

  const parsed=productEventsRequestSchema.safeParse(await req.json().catch(()=>null));
  if(!parsed.success)return fail("invalid_request","Lote de eventos inválido.",400,{requestId,details:parsed.error.flatten()});

  const admin=createAdminClient();
  const identities=[...new Set(parsed.data.events.map((x)=>x.source+"\u0000"+x.external_customer_id))];
  const resolved=await Promise.all(identities.map(async(key)=>{
    const [source,external]=key.split("\u0000") as [string,string];
    const r=await admin.from("saas_account_identities").select("account_id")
      .eq("organization_id",auth.organizationId).eq("source",source).eq("external_customer_id",external).maybeSingle();
    if(r.error)throw r.error;return [key,r.data?.account_id??null] as const;
  })).catch(()=>null);
  if(!resolved)return fail("internal_error","Falha ao resolver contas SaaS.",500,{requestId});
  const byIdentity=new Map(resolved);
  let accepted=0,duplicates=0;
  const rejected:Array<{external_event_id:string;code:string}>=[];
  for(const event of parsed.data.events){
    const accountId=byIdentity.get(event.source+"\u0000"+event.external_customer_id);
    if(!accountId){rejected.push({external_event_id:event.external_event_id,code:"customer_identity_not_found"});continue;}
    const r=await admin.rpc("fn_ingest_product_event",{
      p_organization_id:auth.organizationId,p_account_id:accountId,p_source:event.source,
      p_external_event_id:event.external_event_id,p_event_name:event.event_name,
      p_occurred_at:event.occurred_at,p_properties:event.properties??{}
    });
    if(r.error)rejected.push({external_event_id:event.external_event_id,code:"ingestion_failed"});
    else if(r.data)accepted++;else duplicates++;
  }
  return ok({accepted,duplicates,rejected},{status:accepted?201:200,requestId});
}
