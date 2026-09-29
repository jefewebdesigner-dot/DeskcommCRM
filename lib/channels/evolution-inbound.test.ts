import { beforeEach, describe, expect, it, vi } from "vitest";

const dispatch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/waha/ingest", () => ({ dispatchWahaEvent: dispatch }));
// O ramo Evolution não usa nada do Zernio nem da saúde; isolá-los mantém o teste rápido
// e independente da cadeia de auth do app.
vi.mock("./health", () => ({ sincronizarSaudeDaConexao: vi.fn() }));
vi.mock("./zernio/avisos", () => ({ atualizarEspelhoDoTemplate: vi.fn(), avisoDoEvento: vi.fn(), registrarAviso: vi.fn(), saudeDoEvento: vi.fn() }));
vi.mock("./zernio/ingest", () => ({ aplicarEdicaoZernio: vi.fn(), ingestZernioInbound: vi.fn() }));
vi.mock("./zernio/envelope", () => ({ lerEnvelopeZernio: vi.fn() }));
vi.mock("./zernio/webhook", () => ({ parseZernioEdicao: vi.fn(), verifyZernioSignature: vi.fn() }));

import { acceptsInboundWebhook, handleInboundWebhook } from "./inbound";

const SEGREDO = "s".repeat(48);
const sessao = {
  id: "sess-1",
  organization_id: "org-1",
  provider: "evolution",
  evolution_instance_name: "evo_org1_abc",
};
const upsert = (instance = "evo_org1_abc") =>
  JSON.stringify({
    event: "messages.upsert",
    instance,
    data: { key: { id: "M1", remoteJid: "5511@s.whatsapp.net", fromMe: false }, message: { conversation: "oi" } },
  });
const cab = (v: string | null) => new Headers(v ? { "x-gravity-webhook-secret": v } : {});
const entrar = (rawBody: string, headers: Headers, secret: string | null) =>
  handleInboundWebhook({} as never, { session: sessao, rawBody, headers, secret });

beforeEach(() => dispatch.mockReset());

describe("webhook de entrada — Evolution", () => {
  it("é um canal que recebe webhook", () => {
    expect(acceptsInboundWebhook("evolution")).toBe(true);
  });

  it("segredo certo + instância certa entrega à ingestão comum", async () => {
    const r = await entrar(upsert(), cab(SEGREDO), SEGREDO);
    expect(r).toMatchObject({ ok: true, body: { status: "processed" } });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[1]).toMatchObject({ id: "sess-1", organization_id: "org-1" });
    expect(dispatch.mock.calls[0]?.[2]).toMatchObject({ event: "message.any", payload: { id: "M1" } });
  });

  it("falha FECHADO: sem segredo no banco, sem cabeçalho ou com cabeçalho errado", async () => {
    const resultados = [
      await entrar(upsert(), cab(SEGREDO), null),
      await entrar(upsert(), cab("x"), "x"),
      await entrar(upsert(), cab(null), SEGREDO),
      await entrar(upsert(), cab("y".repeat(48)), SEGREDO),
    ];
    for (const r of resultados) expect(r).toMatchObject({ ok: false, code: "unauthorized" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("recusa corpo de OUTRA instância mesmo com o segredo certo", async () => {
    const r = await entrar(upsert("evo_outra_org"), cab(SEGREDO), SEGREDO);
    expect(r).toMatchObject({ ok: false, code: "contrato_violado", message: "instance_mismatch" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("evento que o CRM ignora responde ok sem ingerir", async () => {
    const corpo = JSON.stringify({ event: "qrcode.updated", instance: "evo_org1_abc", data: {} });
    const r = await entrar(corpo, cab(SEGREDO), SEGREDO);
    expect(r).toMatchObject({ ok: true, body: { status: "ignored" } });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("JSON inválido é recusado sem lançar", async () => {
    const r = await entrar("{", cab(SEGREDO), SEGREDO);
    expect(r).toMatchObject({ ok: false, code: "invalid_json" });
  });
});
