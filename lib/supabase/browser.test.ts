// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const criar = vi.hoisted(() => vi.fn(() => ({})));
vi.mock("@neondatabase/neon-js", () => ({
  createClient: criar,
  SupabaseAuthAdapter: vi.fn(() => "adapter"),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  criar.mockClear();
});

describe("cliente Neon na renderização do servidor", () => {
  it("usa URLs de runtime sem depender de window ou variáveis do build", async () => {
    vi.stubEnv("NEON_AUTH_BASE_URL", "https://auth.example.test");
    vi.stubEnv("NEON_DATA_API_URL", "https://data.example.test");
    vi.stubEnv("NEXT_PUBLIC_NEON_AUTH_BASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_NEON_DATA_API_URL", "");
    const { createClient } = await import("./browser");
    createClient();
    expect(criar).toHaveBeenCalledWith({
      auth: { adapter: "adapter", url: "https://auth.example.test" },
      dataApi: { url: "https://data.example.test" },
    });
  });

  it("recusa configuração ausente antes de criar o SDK", async () => {
    for (const key of [
      "NEON_AUTH_BASE_URL",
      "NEON_DATA_API_URL",
      "NEXT_PUBLIC_NEON_AUTH_BASE_URL",
      "NEXT_PUBLIC_NEON_DATA_API_URL",
    ]) {
      vi.stubEnv(key, "");
    }
    const { createClient } = await import("./browser");
    expect(createClient).toThrow(/ausentes/);
    expect(criar).not.toHaveBeenCalled();
  });
});
