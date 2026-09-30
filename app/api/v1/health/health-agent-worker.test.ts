import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * O worker do agent-engine é o único consumidor do dispatch de IA: parado, app e banco
 * seguem respondendo e ninguém atende. O health precisa dizer isso — vivo, idade do
 * batimento, último erro (sanitizado) e estado da fila — sem PII.
 */

const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/env", () => ({
  env: {
    NEON_DATA_API_URL: "https://dados.exemplo.test",
    NEON_AUTH_JWKS_URL: "https://auth.exemplo.test/jwks",
    UPSTASH_REDIS_REST_URL: "https://redis.exemplo.test",
    UPSTASH_REDIS_REST_TOKEN: "token-de-teste",
    INTERNAL_CRON_SECRET: "segredo-interno-de-teste-com-tamanho-suficiente",
    INTERNAL_SECRET: "",
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

const pedido = () => new NextRequest("https://crm.exemplo.com.br/api/v1/health");

async function saude() {
  const { GET } = await import("./route");
  const res = await GET(pedido());
  return (await res.json()).data as { status: string; checks: Record<string, { status: string; reason?: string; detalhe?: Record<string, unknown> }> };
}

const base = {
  registrado: true,
  ultimo_batimento_s: 10,
  ultimo_erro: null,
  ultimo_erro_em: null,
  pendentes: 0,
  prontos_atrasados: 0,
  mais_velho_s: null,
  em_execucao: 0,
};

beforeEach(() => {
  vi.resetModules();
  rpc.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

describe("GET /api/v1/health — agent_worker", () => {
  it("batimento recente e fila em dia → ok, com os agregados", async () => {
    rpc.mockResolvedValue({ data: { ...base, pendentes: 2, mais_velho_s: 5 }, error: null });
    const c = (await saude()).checks.agent_worker!;
    expect(c.status).toBe("ok");
    expect(c.detalhe).toMatchObject({ ultimo_batimento_s: 10, jobs_pendentes: 2, job_mais_antigo_s: 5 });
  });

  it("sem batimento há mais de 2 min → down e a instalação fica unhealthy", async () => {
    rpc.mockResolvedValue({ data: { ...base, ultimo_batimento_s: 400, ultimo_erro: "reaper falhou" }, error: null });
    const s = await saude();
    expect(s.checks.agent_worker).toMatchObject({ status: "down", reason: "worker_parado" });
    expect(s.checks.agent_worker!.detalhe?.ultimo_erro).toBe("reaper falhou");
    expect(s.status).toBe("unhealthy");
  });

  it("nunca registrou batimento → degraded (instalação sem worker), não down", async () => {
    rpc.mockResolvedValue({ data: { ...base, registrado: false, ultimo_batimento_s: null }, error: null });
    expect((await saude()).checks.agent_worker).toMatchObject({ status: "degraded", reason: "nao_configurado" });
  });

  it("job pronto há mais de 2 min sem ser pego → degraded fila_atrasada", async () => {
    rpc.mockResolvedValue({ data: { ...base, prontos_atrasados: 3, pendentes: 3, mais_velho_s: 900 }, error: null });
    expect((await saude()).checks.agent_worker).toMatchObject({ status: "degraded", reason: "fila_atrasada" });
  });

  it("função ausente (schema antigo) ou erro do banco → degraded, nunca derruba a rota", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    expect((await saude()).checks.agent_worker!.status).toBe("degraded");
    rpc.mockRejectedValue(new Error("boom"));
    expect((await saude()).checks.agent_worker!.status).toBe("degraded");
  });
});
