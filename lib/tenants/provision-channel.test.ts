import { describe, expect, it } from "vitest";

import { nomeDaSessaoProvisionada } from "./provision-channel";

describe("provisionamento externo de WhatsApp", () => {
  it("gera nome estável, aceito pelo WAHA e diferente por implantação", () => {
    const a = nomeDaSessaoProvisionada(
      "12345678-1234-1234-1234-123456789abc",
      "zheus-sales-twin",
      "dep-1",
    );
    const b = nomeDaSessaoProvisionada(
      "12345678-1234-1234-1234-123456789abc",
      "zheus-sales-twin",
      "dep-2",
    );
    expect(a).toBe(
      nomeDaSessaoProvisionada(
        "12345678-1234-1234-1234-123456789abc",
        "zheus-sales-twin",
        "dep-1",
      ),
    );
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(54);
    expect(a).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});
