import { describe, expect, it } from "vitest";
import {
  GRAVITY_CRM_CORE_CAPABILITIES,
  VERTICAL_PACKS,
  verticalPack,
} from "@/lib/vertical-packs/catalog";

describe("PeríciaIA → Gravity CRM fusion contract",()=>{
  it("funde na organização existente, nunca em um segundo tenant",()=>{
    const p=VERTICAL_PACKS.periciaia;
    expect(p.fusion).toBe("in_place");
    expect(p.existingOrganizationId).toBe("9563e071-406b-4db2-aaa4-d08846d3267b");
    expect(p.invariants).toContain("do_not_create_second_periciaia_tenant");
    expect(p.invariants).toContain("preserve_contact_ids");
  });

  it("deixa capacidades genéricas no Core e PJe no vertical",()=>{
    expect(GRAVITY_CRM_CORE_CAPABILITIES).toContain("revenue_os");
    expect(GRAVITY_CRM_CORE_CAPABILITIES).toContain("retention_intelligence");
    expect(VERTICAL_PACKS.periciaia.coreOwned).toContain("customer_360");
    expect(VERTICAL_PACKS.periciaia.verticalOwned).toContain("pje_global_token");
    expect(VERTICAL_PACKS.periciaia.coreOwned).not.toContain("pje_global_token" as never);
  });

  it("mantém explícitos os bridges que devem desaparecer após o cutover",()=>{
    expect(VERTICAL_PACKS.periciaia.temporaryBridges).toContain("pje_legacy_bridge");
    expect(VERTICAL_PACKS.periciaia.temporaryBridges).toContain("periciaia-legacy-crm-import");
    expect(verticalPack("periciaia")?.label).toBe("PeríciaIA");
  });
});
