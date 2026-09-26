import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  support: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  fetch: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: mocks.support }));
vi.mock("@/lib/billing-export/config", () => ({
  readConnection: mocks.read,
  saveConnection: mocks.save,
  removeConnection: mocks.remove,
}));
vi.mock("@/lib/billing-export/fetch", () => ({ fetchBillingDashboard: mocks.fetch }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
import { GET, PUT, DELETE } from "./route";

const ORG = "11111111-1111-4111-8111-111111111111";
const dashboard = { stripe: { ok: true, data: {} }, other: { ok: true, data: {} } };
const request = (body?: unknown, org = ORG) =>
  new Request("https://example.test/api/v1/billing-export", {
    method: body ? "PUT" : "GET",
    headers: { "X-Organization-Id": org },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.role.mockResolvedValue({ ok: true, org: { orgId: ORG }, user: { id: "actor" } });
  mocks.support.mockResolvedValue(null);
  mocks.fetch.mockResolvedValue(dashboard);
});
describe("autorização e segredo billing", () => {
  it("nega leitura antes de tocar credencial ou upstream", async () => {
    mocks.role.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.role).toHaveBeenCalledWith("manager", expect.anything());
  });
  it("lê apenas conexão da organização ativa e nunca retorna token", async () => {
    mocks.read.mockResolvedValue({ token: "server-secret", updated_at: "2026-09-25T12:00:00Z" });
    const response = await GET(request());
    expect(mocks.read).toHaveBeenCalledWith(ORG);
    expect(await response.text()).not.toContain("server-secret");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("sem conexão é diferente de erro de armazenamento", async () => {
    mocks.read.mockResolvedValue(null);
    expect(await (await GET(request())).json()).toMatchObject({
      data: { configured: false, dashboard: null },
    });
    mocks.read.mockRejectedValue(new Error("secret-db-error"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret-db-error");
  });
  it("body não escolhe tenant e entrada inválida não alcança armazenamento", async () => {
    expect(
      (await PUT(request({ token: "synthetic-secret-token", organization_id: "other" }))).status,
    ).toBe(422);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("só admin salva após validar ambas fontes; auditoria não contém segredo", async () => {
    const response = await PUT(request({ token: "synthetic-secret-token" }));
    expect(response.status).toBe(200);
    expect(mocks.role).toHaveBeenCalledWith("admin", expect.anything());
    expect(mocks.save).toHaveBeenCalledWith(ORG, "synthetic-secret-token");
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("synthetic-secret-token");
    expect(await response.text()).not.toContain("synthetic-secret-token");
  });
  it("falha da nova conexão preserva credencial anterior", async () => {
    mocks.fetch.mockResolvedValue({ ...dashboard, stripe: { ok: false, error: "unauthorized" } });
    expect((await PUT(request({ token: "synthetic-secret-token" }))).status).toBe(422);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("nega escrita em acompanhamento somente leitura", async () => {
    mocks.support.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await PUT(request({ token: "synthetic-secret-token" }))).status).toBe(403);
    expect((await DELETE(request())).status).toBe(403);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("aba antiga não consulta, salva nem remove na organização trocada", async () => {
    const old = "22222222-2222-4222-8222-222222222222";
    expect((await GET(request(undefined, old))).status).toBe(409);
    expect((await PUT(request({ token: "synthetic-secret-token" }, old))).status).toBe(409);
    expect((await DELETE(request(undefined, old))).status).toBe(409);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("desconecta somente organização autorizada", async () => {
    expect((await DELETE(request())).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith(ORG);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "billing_export.disconnected", organizationId: ORG }),
    );
  });
});
