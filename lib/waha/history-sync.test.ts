import { describe, expect, it } from "vitest";
import { payloadHistoricoDoStore } from "@/lib/waha/history-normalization";

describe("payloadHistoricoDoStore", () => {
  it("aceita o formato de WAMessage do store", () => {
    const payload = payloadHistoricoDoStore({
      id: "ABC123",
      timestamp: 1_790_000_000,
      from: "554799999999@s.whatsapp.net",
      to: "554788888888@s.whatsapp.net",
      fromMe: false,
      body: "Olá",
      hasMedia: false,
      ack: 3,
      ackName: "READ",
      _data: { key: { remoteJidAlt: "554799999999@s.whatsapp.net" } },
    });

    expect(payload).toMatchObject({ id: "ABC123", body: "Olá", fromMe: false });
  });

  it("recusa campo tipado em formato incompatível", () => {
    expect(
      payloadHistoricoDoStore({ id: 123, fromMe: "não", body: { texto: "x" } }),
    ).toBeNull();
  });
});
