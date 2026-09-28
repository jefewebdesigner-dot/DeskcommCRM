import { describe, expect, it } from "vitest";

import {
  RESPOSTAS_RAPIDAS_SUGERIDAS,
  respostaSugeridaPorAtalhoOuTitulo,
} from "@/lib/inbox/respostas-sugeridas";

describe("pacote de respostas rápidas sugeridas", () => {
  it("cobre o ciclo comercial e financeiro essencial", () => {
    const atalhos = new Set(RESPOSTAS_RAPIDAS_SUGERIDAS.map((item) => item.shortcut));
    for (const atalho of [
      "inicio",
      "proposta",
      "followup",
      "contratou",
      "onboarding",
      "vence",
      "cobranca",
      "pagamento",
      "faltou",
      "posvenda",
    ]) {
      expect(atalhos.has(atalho), `atalho /${atalho} ausente`).toBe(true);
    }
  });

  it("não repete atalho e todas as respostas têm objetivo operacional", () => {
    const atalhos = RESPOSTAS_RAPIDAS_SUGERIDAS.map((item) => item.shortcut.toLowerCase());
    expect(new Set(atalhos).size).toBe(atalhos.length);
    expect(RESPOSTAS_RAPIDAS_SUGERIDAS.every((item) => item.objetivo.trim().length > 0)).toBe(true);
  });

  it("reencontra uma resposta instalada pelo atalho ou pelo título", () => {
    expect(respostaSugeridaPorAtalhoOuTitulo({ title: "Outro nome", shortcut: "pagamento" })?.title).toBe(
      "Pagamento confirmado",
    );
    expect(respostaSugeridaPorAtalhoOuTitulo({ title: "Pós-venda", shortcut: null })?.shortcut).toBe(
      "posvenda",
    );
  });
});
