import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "00000000-0000-4000-8000-000000000001";

vi.mock("@/lib/env", () => ({
  env: { INTERNAL_CRON_SECRET: "segredo", INTERNAL_SECRET: "" },
}));

const mocks = vi.hoisted(() => ({
  seed: vi.fn(),
  observa: vi.fn(),
  vence: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: mocks.error, warn: mocks.warn, info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/leads/risk-seed", () => ({
  semeiaEstadosDeRisco: mocks.seed,
}));

vi.mock("@/lib/leads/risk-worker", () => ({
  observaTravessias: mocks.observa,
}));

vi.mock("@/lib/leads/reactivation", () => ({
  venceReativacoes: mocks.vence,
}));

function adminDuble() {
  return {
    from(tabela: string) {
      if (tabela === "crm_leads") {
        return {
          select: () => ({
            eq: async () => ({ data: [{ organization_id: ORG }], error: null }),
          }),
        };
      }
      if (tabela === "crm_lead_risk_states") {
        return {
          select: () => ({
            eq: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
          }),
        };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => adminDuble(),
}));

import { GET } from "@/app/api/v1/cron/risk-watcher/route";

function req() {
  return {
    headers: new Headers({ authorization: "Bearer segredo" }),
  } as Parameters<typeof GET>[0];
}

beforeEach(() => {
  mocks.seed.mockReset().mockResolvedValue({
    gravados: 436,
    porBucket: { critico: 100, em_risco: 200, em_voo: 50, em_dia: 86 },
    semRelogio: 0,
    itemDeCaixaId: "item-1",
  });
  mocks.observa.mockReset();
  mocks.vence.mockReset().mockResolvedValue({
    vencidas: 0,
    itensDeCaixa: 0,
    falhasDeAtividade: 0,
  });
  mocks.error.mockReset();
  mocks.warn.mockReset();
});

describe("risk-watcher — estreia segura", () => {
  it("semeia backlog sem fabricar travessias quando a org ainda não tem estado", async () => {
    const response = await GET(req());
    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: Record<string, number> };
    expect(mocks.seed).toHaveBeenCalledWith(expect.anything(), ORG);
    expect(mocks.observa).not.toHaveBeenCalled();
    expect(body.data.organizacoes_semeadas).toBe(1);
    expect(body.data.estados_semeados).toBe(436);
    expect(body.data.travessias).toBe(0);
    expect(body.data.esfriaram).toBe(0);
    expect(body.data.propostas_criadas).toBe(0);
    expect(body.data.organizations_com_erro).toBe(0);
  });
});
