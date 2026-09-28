import { describe, expect, it } from "vitest";

import {
  FUNIS_OPERACIONAIS,
  rotuloDoTipoOperacional,
  tipoOperacionalDoFunil,
} from "@/lib/pipelines/funis-operacionais";

describe("funis operacionais", () => {
  it("define os quatro kanbans aprovados sem repetir tipo", () => {
    expect(FUNIS_OPERACIONAIS.map((f) => f.kind)).toEqual([
      "sales",
      "post_sales",
      "support",
      "retention",
    ]);
    expect(new Set(FUNIS_OPERACIONAIS.map((f) => f.kind)).size).toBe(4);
  });

  it("cada funil tem exatamente um terminal de sucesso e um de encerramento", () => {
    for (const funil of FUNIS_OPERACIONAIS) {
      expect(funil.etapas.filter((e) => e.won)).toHaveLength(1);
      expect(funil.etapas.filter((e) => e.lost)).toHaveLength(1);
      expect(funil.etapas).toHaveLength(8);
    }
  });

  it("retencao preserva regularizado e cancelado como desfechos distintos", () => {
    const retencao = FUNIS_OPERACIONAIS.find((f) => f.kind === "retention")!;
    expect(retencao.etapas.find((e) => e.won)?.nome).toBe("Regularizado");
    expect(retencao.etapas.find((e) => e.lost)?.nome).toBe("Cancelado");
    expect(retencao.etapas.some((e) => e.nome === "Cancelamento solicitado")).toBe(true);
    expect(retencao.etapas.some((e) => e.nome === "Retenção")).toBe(true);
  });

  it("reconhece o tipo pelo settings do pipeline", () => {
    expect(tipoOperacionalDoFunil({ operational_kind: "support" })).toBe("support");
    expect(tipoOperacionalDoFunil({ operational_kind: "qualquer" })).toBeNull();
    expect(rotuloDoTipoOperacional("post_sales")).toBe("Pós-vendas");
  });
});
