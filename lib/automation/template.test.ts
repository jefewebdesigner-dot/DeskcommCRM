import { describe, it, expect } from "vitest";
import { renderTemplate } from "@/lib/automation/template";

const ctx = { contact: { name: "Ana" }, lead: { title: "Pedido X", custom_fields: { cupom: "BF10" } } };

describe("renderTemplate", () => {
  it("variável simples", () =>
    expect(renderTemplate("Oi {{contact.name}}!", ctx)).toBe("Oi Ana!"));
  it("path aninhado", () =>
    expect(renderTemplate("Use {{lead.custom_fields.cupom}}", ctx)).toBe("Use BF10"));
  it("alias {{nome}} resolve contact.name", () =>
    expect(renderTemplate("Oi {{nome}}", ctx)).toBe("Oi Ana"));
  it("variável ausente vira vazio, não '{{...}}' cru", () =>
    expect(renderTemplate("X{{lead.ghost}}Y", ctx)).toBe("XY"));
  it("espaços dentro das chaves tolerados", () =>
    expect(renderTemplate("Oi {{ contact.name }}", ctx)).toBe("Oi Ana"));

  describe("nomeComFallback (texto interno)", () => {
    const opt = { nomeComFallback: true };
    it("sem nome usa o telefone", () =>
      expect(
        renderTemplate("Falar com {{nome}}", { contact: { name: "", phone_number: "+5511999990000" } }, opt),
      ).toBe("Falar com +5511999990000"));
    it("sem nome nem telefone usa o e-mail", () =>
      expect(renderTemplate("Falar com {{nome}}", { contact: { email: "a@b.com" } }, opt)).toBe(
        "Falar com a@b.com",
      ));
    it("sem nada diz 'contato sem nome', nunca corta a frase", () =>
      expect(renderTemplate("Falar com {{nome}}", { contact: {} }, opt)).toBe("Falar com contato sem nome"));
    it("com nome mantém o nome", () =>
      expect(renderTemplate("Falar com {{nome}}", ctx, opt)).toBe("Falar com Ana"));
    it("desligado (mensagem ao cliente) continua vazio", () =>
      expect(renderTemplate("Olá {{nome}}", { contact: { phone_number: "+55" } })).toBe("Olá "));
  });
});
