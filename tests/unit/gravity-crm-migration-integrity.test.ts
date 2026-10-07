import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration=fs.readFileSync(
  path.join(process.cwd(),"neon/migrations/20261007_0038_gravity_crm_saas_core.sql"),
  "utf8",
);

function count(text:string){
  return migration.split(text).length-1;
}

describe("Gravity CRM SaaS Core migration integrity",()=>{
  it("não repete RPCs nem cresce por inserção acidental de conteúdo",()=>{
    expect(Buffer.byteLength(migration,"utf8")).toBeLessThan(40_000);
    expect(count("create or replace function public.fn_reconcile_saas_contact_identity(")).toBe(1);
    expect(count("create or replace function public.fn_resolve_saas_account(")).toBe(1);
    expect(count("create or replace function public.fn_ingest_revenue_observation(")).toBe(1);
    expect(count("create or replace function public.fn_ingest_product_event(")).toBe(1);
  });

  it("usa delimitadores PL/pgSQL válidos nas RPCs críticas",()=>{
    expect(migration).toMatch(/fn_reconcile_saas_contact_identity[\s\S]*as \$\$[\s\S]*end;\s*\$\$;/i);
    expect(migration).toMatch(/fn_resolve_saas_account[\s\S]*as \$\$[\s\S]*end;\s*\$\$;/i);
    expect(migration).toMatch(/fn_ingest_revenue_observation[\s\S]*as \$\$[\s\S]*end;\s*\$\$;/i);
  });

  it("resolve identidade e receita sob lock transacional",()=>{
    expect(migration).toMatch(/fn_reconcile_saas_contact_identity[\s\S]*pg_advisory_xact_lock/i);
    expect(migration).toMatch(/fn_resolve_saas_account[\s\S]*pg_advisory_xact_lock/i);
    expect(migration).toMatch(/fn_ingest_revenue_observation[\s\S]*pg_advisory_xact_lock/i);
  });
});
