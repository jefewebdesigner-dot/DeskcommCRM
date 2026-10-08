import { describe, expect, it } from "vitest";

import { evaluatePericiaiaCutover } from "@/lib/vertical-packs/periciaia-cutover";

describe("PeríciaIA cutover gate", () => {
  it("só fica pronto quando identidade, receita e PJe estão preservados", () => {
    const ready = evaluatePericiaiaCutover({
      packStatus: "transitioning",
      eligibleContacts: 42,
      missingAccounts: 0,
      expectedIdentities: 43,
      missingIdentities: 0,
      identityConflicts: 0,
      expectedSubscriptions: 43,
      missingRevenueStates: 0,
      incompleteBaselineSources: 0,
      pjeConfigured: true,
      legacyBridgeConfigured: true,
    });
    expect(ready.blockingReady).toBe(true);
  });

  it("um único cliente sem vínculo bloqueia o cutover", () => {
    const blocked = evaluatePericiaiaCutover({
      packStatus: "transitioning",
      eligibleContacts: 42,
      missingAccounts: 1,
      expectedIdentities: 43,
      missingIdentities: 0,
      identityConflicts: 0,
      expectedSubscriptions: 43,
      missingRevenueStates: 0,
      incompleteBaselineSources: 0,
      pjeConfigured: true,
      legacyBridgeConfigured: true,
    });
    expect(blocked.blockingReady).toBe(false);
    expect(blocked.checks.find((item) => item.id === "customer360")?.ok).toBe(false);
  });

  it("identidade ligada à conta errada bloqueia o cutover", () => {
    const blocked = evaluatePericiaiaCutover({
      packStatus: "transitioning",
      eligibleContacts: 42,
      missingAccounts: 0,
      expectedIdentities: 43,
      missingIdentities: 0,
      identityConflicts: 1,
      expectedSubscriptions: 43,
      missingRevenueStates: 0,
      incompleteBaselineSources: 0,
      pjeConfigured: true,
      legacyBridgeConfigured: true,
    });
    expect(blocked.blockingReady).toBe(false);
    expect(blocked.checks.find((item) => item.id === "identities")?.ok).toBe(false);
  });

  it("baseline financeiro incompleto bloqueia o cutover", () => {
    const blocked = evaluatePericiaiaCutover({
      packStatus: "transitioning",
      eligibleContacts: 42,
      missingAccounts: 0,
      expectedIdentities: 43,
      missingIdentities: 0,
      identityConflicts: 0,
      expectedSubscriptions: 43,
      missingRevenueStates: 0,
      incompleteBaselineSources: 1,
      pjeConfigured: true,
      legacyBridgeConfigured: true,
    });
    expect(blocked.blockingReady).toBe(false);
    expect(blocked.checks.find((item) => item.id === "revenue")?.ok).toBe(false);
  });

  it("depois de ativo, a ponte legada pode ser retirada sem reabrir a fusão", () => {
    const active = evaluatePericiaiaCutover({
      packStatus: "active",
      eligibleContacts: 42,
      missingAccounts: 0,
      expectedIdentities: 43,
      missingIdentities: 0,
      identityConflicts: 0,
      expectedSubscriptions: 43,
      missingRevenueStates: 0,
      incompleteBaselineSources: 0,
      pjeConfigured: true,
      legacyBridgeConfigured: false,
    });
    expect(active.checks.find((item) => item.id === "legacy_bridge")?.blocking).toBe(false);
    expect(active.blockingReady).toBe(true);
  });
});
