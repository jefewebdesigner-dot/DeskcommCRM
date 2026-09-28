import { describe, expect, it } from "vitest";

import { inferirSugestaoRespostaRapida } from "@/lib/inbox/sugestao-resposta-rapida";

const agora = new Date("2026-09-28T18:00:00.000Z");

function base() {
  return {
    agora,
    financeiros: [],
    tarefasAbertas: [],
    compromissosRecentes: [],
    negocios: [],
  };
}

describe("sugestão contextual de resposta rápida", () => {
  it("prioriza cobrança quando o billing diz atrasado", () => {
    expect(
      inferirSugestaoRespostaRapida({
        ...base(),
        financeiros: [{ statusPagamento: "atrasado", renovaEm: null }],
        tarefasAbertas: [{ title: "Fazer pós-venda" }],
      })?.shortcut,
    ).toBe("cobranca");
  });

  it("sugere mensagem de falta somente na janela recente", () => {
    expect(
      inferirSugestaoRespostaRapida({
        ...base(),
        compromissosRecentes: [
          { status: "no_show", outcomeRecordedAt: "2026-09-28T12:00:00.000Z" },
        ],
      })?.shortcut,
    ).toBe("faltou");
    expect(
      inferirSugestaoRespostaRapida({
        ...base(),
        compromissosRecentes: [
          { status: "no_show", outcomeRecordedAt: "2026-09-26T12:00:00.000Z" },
        ],
      }),
    ).toBeNull();
  });

  it("transforma tarefas explícitas em resposta recomendada", () => {
    expect(
      inferirSugestaoRespostaRapida({
        ...base(),
        tarefasAbertas: [{ title: "Validar onboarding do cliente" }],
      })?.shortcut,
    ).toBe("onboarding");
    expect(
      inferirSugestaoRespostaRapida({
        ...base(),
        tarefasAbertas: [{ title: "Fazer follow-up da proposta" }],
      })?.shortcut,
    ).toBe("followup");
  });

  it("lembra vencimento somente quando a renovação está nos próximos 3 dias", () => {
    expect(
      inferirSugestaoRespostaRapida({
        ...base(),
        financeiros: [
          { statusPagamento: "ativo", renovaEm: "2026-09-30T18:00:00.000Z" },
        ],
      })?.shortcut,
    ).toBe("vence");
    expect(
      inferirSugestaoRespostaRapida({
        ...base(),
        financeiros: [
          { statusPagamento: "ativo", renovaEm: "2026-10-05T18:00:00.000Z" },
        ],
      }),
    ).toBeNull();
  });

  it("sugere follow-up para proposta parada e não para proposta recém-movida", () => {
    expect(
      inferirSugestaoRespostaRapida({
        ...base(),
        negocios: [
          {
            status: "open",
            etapaNome: "Proposta enviada",
            lastActivityAt: "2026-09-27T12:00:00.000Z",
          },
        ],
      })?.shortcut,
    ).toBe("followup");
    expect(
      inferirSugestaoRespostaRapida({
        ...base(),
        negocios: [
          {
            status: "open",
            etapaNome: "Proposta enviada",
            lastActivityAt: "2026-09-28T12:00:00.000Z",
          },
        ],
      }),
    ).toBeNull();
  });

  it("não chama billing sincronizado de contratação nova a cada rodada", () => {
    expect(
      inferirSugestaoRespostaRapida({
        ...base(),
        negocios: [
          {
            status: "won",
            source: "periciaia_billing",
            closedAt: "2026-09-28T17:30:00.000Z",
          },
        ],
      }),
    ).toBeNull();
    expect(
      inferirSugestaoRespostaRapida({
        ...base(),
        negocios: [
          {
            status: "won",
            source: "instagram",
            closedAt: "2026-09-28T17:30:00.000Z",
          },
        ],
      })?.shortcut,
    ).toBe("contratou");
  });
});
