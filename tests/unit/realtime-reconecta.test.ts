import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const FONTE = readFileSync("hooks/realtime/useRealtimeChannel.ts", "utf8");

describe("atualizacao ao vivo no backend Neon", () => {
  it("nao abre socket/canal Supabase", () => {
    expect(FONTE).not.toMatch(/\.channel\(/);
    expect(FONTE).not.toMatch(/postgres_changes/);
    expect(FONTE).not.toMatch(/removeChannel/);
  });

  it("autentica antes de iniciar a reconciliacao", () => {
    expect(FONTE).toMatch(/await prepareRealtimeAuthentication\(\)/);
    expect(FONTE).toMatch(/setStatus\("subscribed"\)/);
  });

  it("reconcilia periodicamente sem baixar tabela inteira no hook", () => {
    expect(FONTE).toMatch(/const POLLING_MS = 3_000/);
    expect(FONTE).toMatch(/setInterval\(reconciliar, POLLING_MS\)/);
    expect(FONTE).toMatch(/source: "neon-poll"/);
  });

  it("falha de auth fica fechada e tenta novamente", () => {
    expect(FONTE).toMatch(/setStatus\("channel_error"\)/);
    expect(FONTE).toMatch(/Math\.max\(POLLING_MS, 5_000\)/);
  });

  it("foco, online e volta da aba disparam reconciliacao", () => {
    expect(FONTE).toMatch(/addEventListener\("focus", reconciliar\)/);
    expect(FONTE).toMatch(/addEventListener\("online", reconciliar\)/);
    expect(FONTE).toMatch(/visibilitychange/);
  });

  it("cleanup cancela o timer e os listeners", () => {
    expect(FONTE).toMatch(/if \(timer\) clearInterval\(timer\)/);
    expect(FONTE).toMatch(/removeEventListener\("focus", reconciliar\)/);
    expect(FONTE).toMatch(/removeEventListener\("online", reconciliar\)/);
  });
});