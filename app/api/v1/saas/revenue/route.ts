import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { McpAuthError, ensureScope, validateBearerToken } from "@/lib/mcp/auth";
import { revenueObservationSchema } from "@/lib/schemas/product-events";
import { canUseRevenueBaseline, ingestRevenueObservation } from "@/lib/saas/revenue";
import { syncCustomerActionCenter } from "@/lib/saas/actions";

export const dynamic="force-dynamic";

export async function POST(req:NextRequest):Promise<Response>{
  const requestId=randomUUID();
  let auth:Awaited<ReturnType<typeof validateBearerToken>>;
  try{auth=await validateBearerToken(req.headers.get("authorization"));ensureScope(auth.scopes,"saas_revenue:write");}
  catch(error){
    if(error instanceof McpAuthError)return fail(error.httpStatus===403?"forbidden":"unauthenticated","Token inválido ou sem permissão.",error.httpStatus,{requestId});
    return fail("internal_error","Não foi possível validar o token.",500,{requestId});
  }
  const rate=await checkRateLimit("saas-revenue:"+auth.apiTokenId,300,60);
  if(!rate.allowed)return fail("rate_limited","Limite de observações excedido.",429,{requestId,headers:{"Retry-After":String(rate.window_sec)}});
  const parsed=revenueObservationSchema.safeParse(await req.json().catch(()=>null));
  if(!parsed.success)return fail("invalid_request","Observação de assinatura inválida.",400,{requestId,details:parsed.error.flatten()});
  if(parsed.data.baseline===true&&!canUseRevenueBaseline(auth.scopes)){
    return fail(
      "forbidden",
      "Baseline exige o escopo saas_revenue:baseline.",
      403,
      {requestId},
    );
  }
  try{
    const result=await ingestRevenueObservation(auth.organizationId,parsed.data);
    try{await syncCustomerActionCenter(auth.organizationId);}
    catch(error){console.error("[gravity-crm.revenue] customer action reconcile failed",error);}
    return ok(result,{status:201,requestId});
  }catch(error){
    return fail("ingestion_failed",error instanceof Error?error.message:"Falha ao registrar receita.",500,{requestId});
  }
}
