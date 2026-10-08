import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { verticalPack, type VerticalPackId } from "@/lib/vertical-packs/catalog";

export type OrganizationVerticalPack={
  organization_id:string;
  pack_id:VerticalPackId;
  status:"transitioning"|"active"|"disabled";
  config:Record<string,unknown>;
};

export async function loadOrganizationVerticalPacks(organizationId:string):Promise<OrganizationVerticalPack[]>{
  const admin=createAdminClient();
  const result=await admin.from("organization_vertical_packs")
    .select("organization_id,pack_id,status,config")
    .eq("organization_id",organizationId)
    .neq("status","disabled");
  if(result.error)throw result.error;
  return (result.data??[])
    .filter((row)=>Boolean(verticalPack(String(row.pack_id))))
    .map((row)=>({
      organization_id:String(row.organization_id),
      pack_id:String(row.pack_id) as VerticalPackId,
      status:row.status as OrganizationVerticalPack["status"],
      config:(row.config??{}) as Record<string,unknown>,
    }));
}

export async function organizationHasVerticalPack(
  organizationId:string,
  packId:VerticalPackId,
):Promise<boolean>{
  const packs=await loadOrganizationVerticalPacks(organizationId);
  return packs.some((p)=>p.pack_id===packId&&p.status!=="disabled");
}
