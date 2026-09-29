import { describe, expect, it } from "vitest";

import {
  chaveDaUrlDeMidia,
  lerCorpoDoWebhook,
  segredoConfere,
  statusInternoDaConexao,
  traduzirParaEnvelope,
  type CorpoDoWebhook,
} from "./webhook";

const I = "evo_abc";
const corpo = (event: string, data: unknown): CorpoDoWebhook => ({ event, instance: I, data }) as CorpoDoWebhook;

describe("segredoConfere", () => {
  it("só aceita o segredo exato", () => {
    const s = "x".repeat(40);
    expect(segredoConfere(s, s)).toBe(true);
    expect(segredoConfere(s + "a", s)).toBe(false);
    expect(segredoConfere(null, s)).toBe(false);
    expect(segredoConfere(s, null)).toBe(false);
  });
});

describe("lerCorpoDoWebhook", () => {
  it("separa JSON inválido de contrato violado", () => {
    expect(lerCorpoDoWebhook("{nao json")).toMatchObject({ ok: false, motivo: "json_invalido" });
    expect(lerCorpoDoWebhook("[]")).toMatchObject({ ok: false });
    expect(lerCorpoDoWebhook(JSON.stringify({ event: "messages.upsert", instance: I, data: {} }))).toMatchObject({ ok: true });
  });
});

describe("traduzirParaEnvelope — mensagens", () => {
  const upsert = (key: object, message: object, extra: object = {}) =>
    corpo("messages.upsert", { key, message, pushName: "Cliente", messageTimestamp: 1_760_000_000, ...extra });

  it("texto recebido vira message.any com o id cru do Baileys", () => {
    const env = traduzirParaEnvelope(
      upsert({ id: "3EB0AAA", remoteJid: "5511999990000@s.whatsapp.net", fromMe: false }, { conversation: "olá" }),
      I,
    );
    expect(env).toMatchObject({
      event: "message.any",
      session: I,
      payload: { id: "3EB0AAA", from: "5511999990000@s.whatsapp.net", fromMe: false, body: "olá", type: "chat", hasMedia: false },
    });
  });

  it("mensagem enviada por outro aparelho mantém fromMe", () => {
    const env = traduzirParaEnvelope(upsert({ id: "X1", remoteJid: "5511@s.whatsapp.net", fromMe: true }, { conversation: "e aí" }), I);
    expect(env?.payload?.fromMe).toBe(true);
  });

  it("contato @lid é preservado", () => {
    const env = traduzirParaEnvelope(upsert({ id: "X2", remoteJid: "123456789@lid" }, { conversation: "oi" }), I);
    expect(env?.payload?.from).toBe("123456789@lid");
  });

  it("áudio ptt vira nota de voz e a mídia é opaca (nunca URL buscável)", () => {
    const env = traduzirParaEnvelope(
      upsert({ id: "A1", remoteJid: "5511@s.whatsapp.net" }, { audioMessage: { mimetype: "audio/ogg; codecs=opus", ptt: true } }),
      I,
    );
    expect(env?.payload).toMatchObject({ type: "ptt", hasMedia: true });
    const url = String((env?.payload as { media: { url: string } }).media.url);
    expect(url.startsWith("evolution-media:")).toBe(true);
    expect(chaveDaUrlDeMidia(url)).toEqual({ id: "A1", remoteJid: "5511@s.whatsapp.net", fromMe: false });
  });

  it("documento com legenda embrulhado é reconhecido como documento", () => {
    const env = traduzirParaEnvelope(
      upsert(
        { id: "D1", remoteJid: "5511@s.whatsapp.net" },
        { documentWithCaptionMessage: { message: { documentMessage: { mimetype: "application/pdf", caption: "contrato" } } } },
      ),
      I,
    );
    expect(env?.payload).toMatchObject({ type: "document", hasMedia: true, body: "contrato" });
  });

  it("ignora grupo, status, broadcast e mensagem de protocolo", () => {
    for (const jid of ["1203@g.us", "status@broadcast", "1@newsletter"]) {
      expect(traduzirParaEnvelope(upsert({ id: "G", remoteJid: jid }, { conversation: "x" }), I)).toBeNull();
    }
    expect(
      traduzirParaEnvelope(upsert({ id: "P", remoteJid: "5511@s.whatsapp.net" }, { protocolMessage: {} }, { messageType: "protocolMessage" }), I),
    ).toBeNull();
  });

  it("evento desconhecido ou corpo malformado não traduz (e não lança)", () => {
    expect(traduzirParaEnvelope(corpo("qrcode.updated", {}), I)).toBeNull();
    expect(traduzirParaEnvelope(corpo("messages.upsert", { key: "quebrado" }), I)).toBeNull();
  });
});

describe("traduzirParaEnvelope — ACK, edição, revogação, conexão", () => {
  it.each([
    ["PENDING", 0],
    ["SERVER_ACK", 1],
    ["DELIVERY_ACK", 2],
    ["READ", 3],
    ["PLAYED", 4],
    ["ERROR", -1],
  ])("messages.update %s → ack %i", (status, ack) => {
    const env = traduzirParaEnvelope(corpo("messages.update", { keyId: "K1", remoteJid: "5511@s.whatsapp.net", status }), I);
    expect(env).toMatchObject({ event: "message.ack", payload: { id: "K1", ack } });
  });

  it("DELETED e messages.delete viram revogação", () => {
    expect(traduzirParaEnvelope(corpo("messages.update", { keyId: "K2", status: "DELETED" }), I)?.event).toBe("message.revoked");
    expect(traduzirParaEnvelope(corpo("messages.delete", { keyId: "K3" }), I)).toMatchObject({
      event: "message.revoked",
      payload: { id: "K3" },
    });
  });

  it("edição via protocolMessage aponta para a mensagem original", () => {
    const env = traduzirParaEnvelope(
      corpo("messages.edited", {
        key: { id: "NOVO", remoteJid: "5511@s.whatsapp.net" },
        message: { protocolMessage: { key: { id: "ORIG" }, editedMessage: { conversation: "texto novo" } } },
      }),
      I,
    );
    expect(env).toMatchObject({ event: "message.edited", payload: { id: "ORIG", body: "texto novo" } });
  });

  it("connection.update: open→WORKING, close→STOPPED, refused→FAILED, connecting é ignorado", () => {
    expect(statusInternoDaConexao("open")).toBe("WORKING");
    expect(statusInternoDaConexao("close")).toBe("STOPPED");
    expect(statusInternoDaConexao("refused")).toBe("FAILED");
    expect(statusInternoDaConexao("connecting")).toBeNull();
    expect(traduzirParaEnvelope(corpo("connection.update", { instance: I, state: "open" }), I)).toMatchObject({
      event: "session.status",
      payload: { status: "WORKING" },
    });
    expect(traduzirParaEnvelope(corpo("connection.update", { instance: I, state: "connecting" }), I)).toBeNull();
  });
});
