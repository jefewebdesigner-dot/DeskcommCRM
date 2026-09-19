import { describe, expect, it } from "vitest";

import { prepararAutomacao } from "./apply-blueprint-automations";

const stages = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Novo lead",
    is_won: false,
    is_lost: false,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Agendado",
    is_won: false,
    is_lost: false,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Fechado",
    is_won: true,
    is_lost: false,
  },
];

function automation(
  overrides: Partial<{
    name: string;
    trigger: string;
    delay_minutes: number;
    action: string;
    goal: string;
  }> = {},
) {
  return {
    name: "Retomar lead",
    trigger: "lead_sem_resposta",
    delay_minutes: 120,
    action: "whatsapp_followup",
    goal: "Retomar a conversa",
    ...overrides,
  };
}

describe("Sales Twin native follow-up mapping", () => {
  it("transforma lead sem resposta em trigger nativo de silêncio", () => {
    const result = prepararAutomacao(automation(), "Empresa Teste", stages);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.trigger).toMatchObject({
      kind: "silence",
      params: { threshold_minutes: 120 },
      cancel_on_reply: true,
    });
    expect(result.graph.nodes.some((node) => node.type === "wait")).toBe(false);
    expect(result.graph.nodes.some((node) => node.type === "action")).toBe(true);
  });

  it("transforma nome exato de etapa em stage_change e mantém o atraso no grafo", () => {
    const result = prepararAutomacao(
      automation({ trigger: "Agendado", delay_minutes: 60 }),
      "Empresa Teste",
      stages,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.trigger).toMatchObject({
      kind: "stage_change",
      params: { stage_id: stages[1]!.id },
      cancel_on_reply: true,
    });
    const wait = result.graph.nodes.find((node) => node.type === "wait");
    expect(wait).toMatchObject({
      type: "wait",
      config: { mode: "fixed", duration_ms: 3_600_000 },
    });
  });

  it("transforma no-show em trigger nativo sem inventar etapa", () => {
    const result = prepararAutomacao(
      automation({ trigger: "nao_compareceu", delay_minutes: 120 }),
      "Empresa Teste",
      stages,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.trigger).toMatchObject({
      kind: "appointment_no_show",
      cancel_on_reply: true,
    });
  });

  it("recusa gatilho que o DeskcommCRM não sabe executar", () => {
    const result = prepararAutomacao(
      automation({ trigger: "cliente_inativo_90_dias" }),
      "Empresa Teste",
      stages,
    );
    expect(result).toEqual({ ok: false, reason: "unsupported_trigger" });
  });

  it("recusa etapa explícita inexistente em vez de escolher outra", () => {
    const result = prepararAutomacao(
      automation({ trigger: "etapa: Orçamento aprovado", delay_minutes: 60 }),
      "Empresa Teste",
      stages,
    );
    expect(result).toEqual({ ok: false, reason: "stage_not_found" });
  });

  it("recusa ação fora do motor de follow-up", () => {
    const result = prepararAutomacao(
      automation({ action: "criar_tarefa_interna" }),
      "Empresa Teste",
      stages,
    );
    expect(result).toEqual({ ok: false, reason: "unsupported_action" });
  });
});
