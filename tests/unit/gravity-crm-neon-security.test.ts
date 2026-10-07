import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root=process.cwd();
const core=fs.readFileSync(
  path.join(root,"neon/migrations/20261007_0038_gravity_crm_saas_core.sql"),
  "utf8",
);
const retention=fs.readFileSync(
  path.join(root,"neon/migrations/20261007_0039_gravity_crm_retention.sql"),
  "utf8",
);

describe("Gravity CRM Neon security contract",()=>{
  it("Customer 360 cannot point to a contact from another tenant",()=>{
    expect(core).toMatch(/foreign key \(contact_id, organization_id\)/i);
    expect(core).toMatch(/references public\.contacts\(id, organization_id\)/i);
  });

  it("Revenue RPC is atomic and server-only",()=>{
    expect(core).toMatch(/fn_ingest_revenue_observation[\s\S]*pg_advisory_xact_lock/i);
    expect(core).toMatch(/fn_ingest_revenue_observation[\s\S]*auth\.is_server_service\(\)/i);
    expect(core).toMatch(/grant execute on function public\.fn_ingest_revenue_observation[\s\S]*to authenticated, service_role/i);
  });

  it("Product Events RPC is callable by the technical identity but rejects normal authenticated users",()=>{
    expect(core).toMatch(/fn_ingest_product_event[\s\S]*auth\.is_server_service\(\)/i);
    expect(core).toMatch(/grant execute on function public\.fn_ingest_product_event[\s\S]*to authenticated, service_role/i);
  });

  it("Retention RPC has the same server-only gate",()=>{
    expect(retention).toMatch(/fn_ingest_retention_cancel_event[\s\S]*auth\.is_server_service\(\)/i);
    expect(retention).toMatch(/fn_ingest_retention_cancel_event[\s\S]*pg_advisory_xact_lock/i);
    expect(retention).toMatch(/grant execute on function public\.fn_ingest_retention_cancel_event[\s\S]*to authenticated, service_role/i);
  });
});
