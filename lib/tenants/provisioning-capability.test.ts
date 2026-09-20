import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ env: { TENANT_PROVISIONING_SECRET: "" } }));
vi.mock("@/lib/env", () => ({ env: h.env }));

const {
  mintBlueprintCapability,
  mintChannelCapability,
  verifyBlueprintCapability,
  verifyChannelCapability,
  tenantProvisioningEnabled,
} = await import("./provisioning-capability");

describe("tenant blueprint capability", () => {
  beforeEach(() => {
    h.env.TENANT_PROVISIONING_SECRET = "s".repeat(40);
  });

  it("nasce desligada com segredo ausente/curto", () => {
    h.env.TENANT_PROVISIONING_SECRET = "";
    expect(tenantProvisioningEnabled()).toBe(false);
    expect(() =>
      mintBlueprintCapability({
        organizationId: "org-1",
        integration: "zheus",
        externalId: "dep-1",
      }),
    ).toThrow();
    h.env.TENANT_PROVISIONING_SECRET = "x".repeat(31);
    expect(tenantProvisioningEnabled()).toBe(false);
  });

  it("emite token preso a organização, integração e external_id", () => {
    const token = mintBlueprintCapability({
      organizationId: "org-1",
      integration: "zheus-sales-twin",
      externalId: "dep-42",
      nowSeconds: 1000,
      ttlSeconds: 300,
    });
    const p = verifyBlueprintCapability(token, { nowSeconds: 1100 });
    expect(p).toMatchObject({
      v: 1,
      scope: "tenant:blueprint",
      organization_id: "org-1",
      integration: "zheus-sales-twin",
      external_id: "dep-42",
      iat: 1000,
      exp: 1300,
    });
  });

  it("separa capability de Blueprint da capability de canal", () => {
    const blueprint = mintBlueprintCapability({
      organizationId: "org-1",
      integration: "zheus",
      externalId: "dep-1",
      nowSeconds: 1000,
      ttlSeconds: 300,
    });
    const channel = mintChannelCapability({
      organizationId: "org-1",
      integration: "zheus",
      externalId: "dep-1",
      nowSeconds: 1000,
      ttlSeconds: 300,
    });

    expect(verifyChannelCapability(blueprint, { nowSeconds: 1100 })).toBeNull();
    expect(verifyBlueprintCapability(channel, { nowSeconds: 1100 })).toBeNull();
    expect(verifyChannelCapability(channel, { nowSeconds: 1100 })).toMatchObject({
      scope: "tenant:channel",
      organization_id: "org-1",
      external_id: "dep-1",
    });
  });

  it("recusa adulteração e expiração", () => {
    const token = mintBlueprintCapability({
      organizationId: "org-1",
      integration: "zheus",
      externalId: "dep-1",
      nowSeconds: 1000,
      ttlSeconds: 60,
    });
    expect(verifyBlueprintCapability(token + "x", { nowSeconds: 1010 })).toBeNull();
    expect(verifyBlueprintCapability(token, { nowSeconds: 1060 })).toBeNull();
  });
});
