import { describe, expect, it, vi } from "vitest";

import { EvolutionClient, EvolutionError, getEvolutionClient } from "./client";

function resposta(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

function cliente(fetchImpl: unknown) {
  return new EvolutionClient("https://evo.exemplo.test/", "chave-global", { fetchImpl: fetchImpl as typeof fetch });
}

describe("EvolutionClient", () => {
  it("cria a instância com o webhook da organização, sem grupos e sem eco de QR", async () => {
    const f = vi.fn().mockResolvedValue(
      resposta(201, { instance: { instanceName: "evo_x" }, qrcode: { base64: "data:image/png;base64,AAEC", pairingCode: null } }),
    );
    const r = await cliente(f).createInstance({
      instanceName: "evo_x",
      webhookUrl: "https://crm.test/api/v1/webhooks/channel/tok",
      webhookHeaders: { "x-gravity-webhook-secret": "s".repeat(32) },
    });
    expect(r.instanceName).toBe("evo_x");
    expect([...(r.qr.png ?? [])]).toEqual([0, 1, 2]);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://evo.exemplo.test/instance/create");
    expect((init.headers as Record<string, string>).apikey).toBe("chave-global");
    const corpo = JSON.parse(String(init.body));
    expect(corpo.integration).toBe("WHATSAPP-BAILEYS");
    expect(corpo.groupsIgnore).toBe(true);
    expect(corpo.webhook.events).toContain("MESSAGES_UPSERT");
    expect(corpo.webhook.events).not.toContain("QRCODE_UPDATED");
  });

  it("o erro carrega operação e status, nunca o corpo da resposta", async () => {
    const f = vi.fn().mockResolvedValue(resposta(500, { message: "número 5511999999999 inválido" }));
    const erro = await cliente(f)
      .sendText("evo_x", "5511999999999", "oi")
      .catch((e) => e);
    expect(erro).toBeInstanceOf(EvolutionError);
    expect(erro.message).toBe("evolution_send_500");
    expect(erro.message).not.toContain("5511");
  });

  it("404 marca instância inexistente; falha de rede vira status 0", async () => {
    const a = await cliente(vi.fn().mockResolvedValue(resposta(404, {})))
      .connectionState("evo_x")
      .catch((e) => e);
    expect(a.instanceMissing).toBe(true);
    const b = await cliente(vi.fn().mockRejectedValue(new Error("ECONNREFUSED")))
      .connectionState("evo_x")
      .catch((e) => e);
    expect(b.httpStatus).toBe(0);
    expect(b.instanceMissing).toBe(false);
  });

  it("instanceInfo distingue pareada (ownerJid) de instância inexistente", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(resposta(200, [{ connectionStatus: "connecting", ownerJid: "5511@s.whatsapp.net", profileName: "Ana" }]));
    const i = await cliente(f).instanceInfo("evo_x");
    expect(i).toMatchObject({ state: "connecting", ownerJid: "5511@s.whatsapp.net" });
    const vazio = await cliente(vi.fn().mockResolvedValue(resposta(200, [])))
      .instanceInfo("evo_x")
      .catch((e) => e);
    expect(vazio.instanceMissing).toBe(true);
  });

  it("sendText devolve o id cru e cita a mensagem original", async () => {
    const f = vi.fn().mockResolvedValue(resposta(201, { key: { id: "3EB0ABC", remoteJid: "5511@s.whatsapp.net", fromMe: true } }));
    const r = await cliente(f).sendText("evo_x", "5511", "oi", { id: "ORIG" });
    expect(r.keyId).toBe("3EB0ABC");
    expect(JSON.parse(String((f.mock.calls[0] as [string, RequestInit])[1].body)).quoted.key.id).toBe("ORIG");
  });
});

describe("getEvolutionClient", () => {
  it("é null sem configuração ou com o placeholder", () => {
    expect(getEvolutionClient({})).toBeNull();
    expect(getEvolutionClient({ EVOLUTION_API_BASE_URL: "https://x", EVOLUTION_API_KEY: "dev_plaintext_change_me" })).toBeNull();
    expect(getEvolutionClient({ EVOLUTION_API_BASE_URL: "https://x", EVOLUTION_API_KEY: "k" })).not.toBeNull();
  });
});
