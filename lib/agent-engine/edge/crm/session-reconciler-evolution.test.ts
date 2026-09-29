import { afterEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";

import { createLogger } from "../../obs/logger";
import { reconcileEvolutionSessions, redriveQueued, type WatchdogConfig } from "./session-reconciler";

afterEach(() => vi.restoreAllMocks());

const semWaha = { wahaBaseUrl: "", wahaApiKey: "" };
const base = { intervalMs: 1, redriveMinAgeMs: 0, redriveBatchSize: 10, redriveSpacingMs: 0 };
const comEvolution: WatchdogConfig = {
  ...semWaha,
  ...base,
  evolutionBaseUrl: "https://evo.exemplo.test/",
  evolutionApiKey: "chave-de-teste",
};

interface Linha {
  id: string;
  organization_id: string;
  conversation_id: string;
  body: string | null;
  waha_session_name: string | null;
  evolution_instance_name: string | null;
  wa_identity: string | null;
  wa_lid: string | null;
  phone_number: string | null;
  is_group: boolean;
  group_chat_id: string | null;
}

const linhaEvolution = (extra: Partial<Linha> = {}): Linha => ({
  id: "m-1",
  organization_id: "org-1",
  conversation_id: "conv-1",
  body: "Olá!",
  waha_session_name: null,
  evolution_instance_name: "evo_org1_abc",
  wa_identity: null,
  wa_lid: null,
  phone_number: "+55 (31) 99999-8888",
  is_group: false,
  group_chat_id: null,
  ...extra,
});

function banco(fila: Linha[], presas = "0") {
  const consultas: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    consultas.push({ sql, params });
    if (/count\(\*\)/i.test(sql)) return { rows: [{ n: presas }] };
    if (/select\s+m\.id/i.test(sql)) return { rows: fila };
    if (/select\s+s\.metadata/i.test(sql)) return { rows: [{ metadata: {}, phone_number: "+5531999998888" }] };
    return { rows: [] };
  });
  return { pool: { query } as unknown as pg.Pool, consultas };
}

describe("resgate da fila — sessões da Evolution", () => {
  it("reenvia pelo transporte da Evolution (número só com dígitos) e grava o id cru", async () => {
    const f = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ key: { id: "3EB0REENVIO" } }), { status: 200 }));
    const { pool, consultas } = banco([linhaEvolution()]);

    expect(await redriveQueued(pool, comEvolution, createLogger())).toBe(1);

    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://evo.exemplo.test/message/sendText/evo_org1_abc");
    expect((init.headers as Record<string, string>).apikey).toBe("chave-de-teste");
    expect(JSON.parse(String(init.body))).toEqual({ number: "5531999998888", text: "Olá!" });
    const marca = consultas.find((c) => /set status = 'sent'/.test(c.sql) && /external_id = coalesce/.test(c.sql));
    expect(marca?.params[1]).toBe("3EB0REENVIO");
  });

  it("contato @lid vai como <lid>@lid; grupo vai pelo id do grupo", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ key: { id: "K" } }), { status: 200 }));
    const { pool } = banco([linhaEvolution({ id: "a", wa_lid: "12345678" }), linhaEvolution({ id: "b", is_group: true, group_chat_id: "1203@g.us" })]);
    await redriveQueued(pool, comEvolution, createLogger());
    const numeros = f.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)).number);
    expect(numeros).toEqual(["12345678@lid", "1203@g.us"]);
  });

  it("sem credenciais da Evolution NÃO envia e a consulta as deixa de fora (contadas como presas)", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    const { pool, consultas } = banco([], "2");
    await redriveQueued(pool, { ...semWaha, ...base }, createLogger());
    expect(f).not.toHaveBeenCalled();
    const principal = consultas.find((c) => /select\s+m\.id/i.test(c.sql))!;
    expect(principal.params[2]).toBe(false);
    const contagem = consultas.find((c) => /count\(\*\)/i.test(c.sql))!;
    expect(contagem.params[1]).toBe(false);
  });

  it("falha do transporte mantém queued (nada é marcado enviado)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    const { pool, consultas } = banco([linhaEvolution()]);
    expect(await redriveQueued(pool, comEvolution, createLogger())).toBe(0);
    expect(consultas.some((c) => /set status = 'sent'/.test(c.sql))).toBe(false);
  });

  it("modo de teste do canal bloqueia o reenvio para número fora da lista", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    const consultas: string[] = [];
    const query = vi.fn(async (sql: string) => {
      consultas.push(sql);
      if (/count\(\*\)/i.test(sql)) return { rows: [{ n: "0" }] };
      if (/select\s+m\.id/i.test(sql)) return { rows: [linhaEvolution()] };
      if (/select\s+s\.metadata/i.test(sql)) {
        return { rows: [{ metadata: { ai_gate: "allowlist", ai_gate_mode: "pre_go_live", ai_test_phone_numbers: [] }, phone_number: "+5531999998888" }] };
      }
      return { rows: [] };
    });
    expect(await redriveQueued({ query } as unknown as pg.Pool, comEvolution, createLogger())).toBe(0);
    expect(f).not.toHaveBeenCalled();
    expect(consultas.some((s) => /error_code = 'pre_go_live'/.test(s))).toBe(true);
  });
});

describe("reconcileEvolutionSessions", () => {
  const instancias = (lista: unknown) => vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(lista), { status: 200 }));

  it("espelha o estado real e mapeia connecting pelo dono do aparelho", async () => {
    instancias([
      { name: "evo_a", connectionStatus: "open", ownerJid: "5511@s.whatsapp.net" },
      { name: "evo_b", connectionStatus: "connecting", ownerJid: null },
      { name: "evo_c", connectionStatus: "close" },
      { name: "evo_d", connectionStatus: "estado-novo" },
    ]);
    const escritas: unknown[][] = [];
    const query = vi.fn(async (_sql: string, params: unknown[]) => {
      escritas.push(params);
      return { rows: [{ id: "s" }] };
    });
    const n = await reconcileEvolutionSessions({ query } as unknown as pg.Pool, comEvolution, createLogger());
    expect(escritas).toEqual([
      ["evo_a", "WORKING"],
      ["evo_b", "SCAN_QR_CODE"],
      ["evo_c", "STOPPED"],
    ]);
    expect(n).toBe(3);
  });

  it("Evolution fora do ar ou sem configuração: não escreve nada e não lança", async () => {
    const query = vi.fn();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await reconcileEvolutionSessions({ query } as unknown as pg.Pool, comEvolution, createLogger())).toBe(0);
    expect(await reconcileEvolutionSessions({ query } as unknown as pg.Pool, { ...semWaha, ...base }, createLogger())).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
