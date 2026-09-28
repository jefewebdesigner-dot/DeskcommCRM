import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stripeBillingFixture, otherBillingFixture } from "@/tests/fixtures/billing-export";
import { fetchBillingDashboard } from "./fetch";
import { fetchStripeDirect } from "./stripe-direct";
import { logger } from "@/lib/logger";

vi.mock("./stripe-direct", () => ({ fetchStripeDirect: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));
beforeEach(() => {
  vi.mocked(fetchStripeDirect).mockReset().mockResolvedValue(null);
  vi.mocked(logger.warn).mockClear();
});

afterEach(() => vi.unstubAllGlobals());
describe("consulta billing", () => {
  it("não apresenta resumo incorreto como fallback quando a Stripe direta falha", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json(stripeBillingFixture))
      .mockResolvedValueOnce(Response.json(otherBillingFixture)));
    vi.mocked(fetchStripeDirect).mockRejectedValue(new Error("private-upstream-secret"));
    const result = await fetchBillingDashboard("synthetic-token");
    expect(result.stripe).toEqual({ ok: false, error: "unavailable" });
    expect(result.other.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private-upstream-secret");
    expect(logger.warn).toHaveBeenCalledWith("billing_export_stripe_direct_unavailable");
  });

  it("usa bearer só no header, sem cache nem redirects", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(stripeBillingFixture))
      .mockResolvedValueOnce(Response.json(otherBillingFixture));
    vi.stubGlobal("fetch", fetcher);
    const result = await fetchBillingDashboard("synthetic-token");
    expect(result.stripe.ok).toBe(true);
    expect(result.other.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("synthetic-token");
    for (const [url, opts] of fetcher.mock.calls) {
      expect(url).toMatch(/^https:\/\/www\.periciaia\.com\.br\/api\/admin\/billing-export/);
      expect(url).not.toContain("synthetic-token");
      expect(opts).toMatchObject({
        cache: "no-store",
        redirect: "error",
        headers: { Authorization: "Bearer synthetic-token" },
      });
      expect(opts.signal).toBeDefined();
    }
  });
  it("falha parcial preserva fonte disponível sem usar zeros", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("private upstream content", { status: 401 }))
        .mockResolvedValueOnce(Response.json(otherBillingFixture)),
    );
    const result = await fetchBillingDashboard("synthetic-token");
    expect(result.stripe).toEqual({ ok: false, error: "unauthorized" });
    expect(result.other.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private upstream content");
  });
  it("timeout e contrato inválido são falhas explícitas sem erro bruto", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("secret-in-network-error"))
        .mockResolvedValueOnce(Response.json({ customers: [] })),
    );
    const result = await fetchBillingDashboard("synthetic-token");
    expect(result.stripe).toEqual({ ok: false, error: "unavailable" });
    expect(result.other).toEqual({ ok: false, error: "invalid_data" });
    expect(JSON.stringify(result)).not.toContain("secret-in-network-error");
  });
  it("limita tamanho do corpo sem processar respostas arbitrárias", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => new Response("x".repeat(10 * 1024 * 1024 + 1))),
    );
    const result = await fetchBillingDashboard("synthetic-token");
    expect(result.stripe).toEqual({ ok: false, error: "invalid_data" });
  });
});
