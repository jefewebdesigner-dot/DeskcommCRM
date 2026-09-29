import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { evolutionAdapter, statusInternoDaInstancia } from "./evolution";

const ENV = { ...process.env };
const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  process.env.EVOLUTION_API_BASE_URL = "https://evo.exemplo.test";
  process.env.EVOLUTION_API_KEY = "chave-de-teste";
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ENV };
});

describe("statusInternoDaInstancia", () => {
  it("mapeia o estado da Evolution para o contrato interno de saúde", () => {
    expect(statusInternoDaInstancia({ state: "open", ownerJid: "x" })).toBe("WORKING");
    expect(statusInternoDaInstancia({ state: "connecting", ownerJid: null })).toBe("SCAN_QR_CODE");
    expect(statusInternoDaInstancia({ state: "connecting", ownerJid: "5511@s.whatsapp.net" })).toBe("STARTING");
    expect(statusInternoDaInstancia({ state: "close", ownerJid: null })).toBe("STOPPED");
    expect(statusInternoDaInstancia({ state: "refused", ownerJid: null })).toBe("FAILED");
    expect(statusInternoDaInstancia({ state: "algo-novo", ownerJid: null })).toBeNull();
  });
});

describe("evolutionAdapter.checkHealth", () => {
  const ctx = { organizationId: "org", sessionRef: "evo_x" };

  it("instância aberta → WORKING", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resposta(200, [{ connectionStatus: "open", ownerJid: "5511@s.whatsapp.net" }])));
    expect(await evolutionAdapter.checkHealth!(ctx)).toEqual({ reachable: true, status: "WORKING", detail: null });
  });

  it("instância inexistente → STOPPED (a resposta É o estado)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resposta(200, [])));
    expect(await evolutionAdapter.checkHealth!(ctx)).toMatchObject({ reachable: true, status: "STOPPED" });
  });

  it("chave recusada → inalcançável com o detalhe de credencial (não é o número que caiu)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resposta(401, {})));
    const h = await evolutionAdapter.checkHealth!(ctx);
    expect(h.reachable).toBe(false);
    expect(h.status).toBeNull();
    expect(h.detail).toBeTruthy();
  });

  it("rede fora → inalcançável, sem inventar estado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    expect(await evolutionAdapter.checkHealth!(ctx)).toMatchObject({ reachable: false, status: null });
  });

  it("sem configuração → inalcançável", async () => {
    delete process.env.EVOLUTION_API_KEY;
    expect(await evolutionAdapter.checkHealth!(ctx)).toMatchObject({ reachable: false, status: null });
  });
});

describe("evolutionAdapter — pareamento", () => {
  it("QR pronto vira imagem; ainda sem QR é 'pending'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resposta(200, { base64: "data:image/png;base64,AAEC" })));
    const q = await evolutionAdapter.fetchPairingQr!({ organizationId: "o", sessionRef: "evo_x" });
    expect(q).toMatchObject({ kind: "image", contentType: "image/png" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resposta(200, { count: 0 })));
    expect(await evolutionAdapter.fetchPairingQr!({ organizationId: "o", sessionRef: "evo_x" })).toEqual({ kind: "pending" });
  });

  it("código de pareamento sai formatado; instância conectada não gera código", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(resposta(200, [{ connectionStatus: "connecting" }]))
        .mockResolvedValueOnce(resposta(200, { pairingCode: "abcd1234" })),
    );
    expect(await evolutionAdapter.requestPairingCode!({ organizationId: "o", sessionRef: "evo_x", phone: "5511999990000" })).toEqual({
      kind: "code",
      code: "ABCD-1234",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resposta(200, [{ connectionStatus: "open" }])));
    expect(await evolutionAdapter.requestPairingCode!({ organizationId: "o", sessionRef: "evo_x", phone: "5511999990000" })).toEqual({
      kind: "already_connected",
    });
  });
});

describe("evolutionAdapter.send", () => {
  it("texto sai pela instância da sessão e devolve o id cru", async () => {
    const f = vi.fn().mockResolvedValue(resposta(201, { key: { id: "3EB0Z", remoteJid: "5511@s.whatsapp.net", fromMe: true } }));
    vi.stubGlobal("fetch", f);
    const r = await evolutionAdapter.send({
      organizationId: "org",
      sessionRef: "evo_x",
      to: "5511999990000",
      kind: "text",
      body: "olá",
    } as never);
    expect(r.externalId).toBe("3EB0Z");
    expect(String(f.mock.calls[0]?.[0])).toBe("https://evo.exemplo.test/message/sendText/evo_x");
  });

  it("beforeSend roda ANTES do transporte", async () => {
    const ordem: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        ordem.push("http");
        return resposta(201, { key: { id: "K" } });
      }),
    );
    await evolutionAdapter.send({
      organizationId: "org",
      sessionRef: "evo_x",
      to: "5511999990000",
      kind: "text",
      body: "olá",
      beforeSend: async () => void ordem.push("guarda"),
    } as never);
    expect(ordem).toEqual(["guarda", "http"]);
  });
});
