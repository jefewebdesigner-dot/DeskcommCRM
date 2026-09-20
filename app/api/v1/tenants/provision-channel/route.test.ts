import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  enabled: true,
  verify: vi.fn(),
  provision: vi.fn(),
}));

vi.mock("@/lib/tenants/provisioning-capability", () => ({
  tenantProvisioningEnabled: () => h.enabled,
  verifyChannelCapability: h.verify,
}));
vi.mock("@/lib/tenants/provision-channel", () => ({
  provisionExternalWahaChannel: h.provision,
}));

const { POST } = await import("./route");

function pedido(token: string | null, body: unknown = { deployment_id: "dep-42" }) {
  return new NextRequest("http://localhost/api/v1/tenants/provision-channel", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.enabled = true;
  h.verify.mockReturnValue({
    v: 1,
    scope: "tenant:channel",
    organization_id: "org-1",
    integration: "zheus-sales-twin",
    external_id: "dep-42",
    iat: 1,
    exp: 9999999999,
    jti: "x",
  });
  h.provision.mockResolvedValue({
    organization_id: "org-1",
    channel_session_id: "channel-1",
    session_name: "st_org1_x",
    status: "SCAN_QR_CODE",
    phone_number: null,
    replay: false,
    requires_pairing: true,
  });
});

describe("POST /tenants/provision-channel", () => {
  it("rota não existe quando provisionamento está desligado", async () => {
    h.enabled = false;
    expect((await POST(pedido("cap"))).status).toBe(404);
    expect(h.provision).not.toHaveBeenCalled();
  });

  it("recusa capability inválida", async () => {
    h.verify.mockReturnValue(null);
    expect((await POST(pedido(null))).status).toBe(401);
    expect(h.provision).not.toHaveBeenCalled();
  });

  it("não aceita deployment de outra capability", async () => {
    expect((await POST(pedido("cap", { deployment_id: "dep-outro" }))).status).toBe(403);
    expect(h.provision).not.toHaveBeenCalled();
  });

  it("não aceita organização enviada pelo cliente", async () => {
    expect(
      (await POST(pedido("cap", { deployment_id: "dep-42", organization_id: "org-2" }))).status,
    ).toBe(422);
    expect(h.provision).not.toHaveBeenCalled();
  });

  it("prepara somente o canal da organização codificada na capability", async () => {
    const res = await POST(pedido("cap", { deployment_id: "dep-42", display_name: "WhatsApp Vendas" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(h.provision).toHaveBeenCalledWith({
      organizationId: "org-1",
      integration: "zheus-sales-twin",
      externalId: "dep-42",
      displayName: "WhatsApp Vendas",
    });
  });
});
