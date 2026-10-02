import { describe, expect, it } from "vitest";
import { modoDeRecuperacaoDoWhatsapp } from "./estado-da-recuperacao";

describe("recuperação da sessão WhatsApp", () => {
  it("nunca transforma STOPPED em logout/novo QR", () => {
    expect(modoDeRecuperacaoDoWhatsapp("STOPPED")).toBe("retomar");
  });

  it("reserva novo pareamento para FAILED", () => {
    expect(modoDeRecuperacaoDoWhatsapp("FAILED")).toBe("reparear");
  });

  it("não oferece reparo destrutivo para estados vivos", () => {
    expect(modoDeRecuperacaoDoWhatsapp("WORKING")).toBeNull();
    expect(modoDeRecuperacaoDoWhatsapp("STARTING")).toBeNull();
    expect(modoDeRecuperacaoDoWhatsapp("SCAN_QR_CODE")).toBeNull();
  });
});
