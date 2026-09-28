import { describe, expect, it } from "vitest";

import {
  idDaTarefaAutomaticaDaAgenda,
  pendenciaOperacionalDaAgenda,
} from "@/lib/agenda/pendencias-operacionais";

const AGORA = new Date("2026-09-28T15:00:00.000Z");

function compromisso(overrides: Partial<{
  id: string;
  contact_id: string | null;
  status: string;
  ends_at: string;
  outcome_recorded_at: string | null;
}> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    contact_id: "22222222-2222-4222-8222-222222222222",
    status: "confirmed",
    ends_at: "2026-09-28T13:00:00.000Z",
    outcome_recorded_at: null,
    ...overrides,
  };
}

describe("pendências operacionais da Agenda", () => {
  it("cobra o resultado quando o horário passou há mais de 30 min", () => {
    expect(
      pendenciaOperacionalDaAgenda({
        compromisso: compromisso(),
        agora: AGORA,
        temTarefaAbertaDoContato: false,
      }),
    ).toBe("registrar_resultado");
  });

  it("não cobra enquanto a reunião ainda está terminando", () => {
    expect(
      pendenciaOperacionalDaAgenda({
        compromisso: compromisso({ ends_at: "2026-09-28T14:45:00.000Z" }),
        agora: AGORA,
        temTarefaAbertaDoContato: false,
      }),
    ).toBeNull();
  });

  it("depois do resultado, cria cobrança de próximo passo só se não houver tarefa aberta", () => {
    const encerrado = compromisso({
      status: "completed",
      outcome_recorded_at: "2026-09-28T13:30:00.000Z",
    });
    expect(
      pendenciaOperacionalDaAgenda({
        compromisso: encerrado,
        agora: AGORA,
        temTarefaAbertaDoContato: false,
      }),
    ).toBe("definir_proximo_passo");
    expect(
      pendenciaOperacionalDaAgenda({
        compromisso: encerrado,
        agora: AGORA,
        temTarefaAbertaDoContato: true,
      }),
    ).toBeNull();
  });

  it("não transforma cancelado ou compromisso sem cliente em tarefa", () => {
    expect(
      pendenciaOperacionalDaAgenda({
        compromisso: compromisso({ status: "cancelled" }),
        agora: AGORA,
        temTarefaAbertaDoContato: false,
      }),
    ).toBeNull();
    expect(
      pendenciaOperacionalDaAgenda({
        compromisso: compromisso({ contact_id: null }),
        agora: AGORA,
        temTarefaAbertaDoContato: false,
      }),
    ).toBeNull();
  });

  it("gera id estável por compromisso e tipo, mas tipos diferentes não colidem", () => {
    const a = idDaTarefaAutomaticaDaAgenda(compromisso().id, "registrar_resultado");
    const b = idDaTarefaAutomaticaDaAgenda(compromisso().id, "registrar_resultado");
    const c = idDaTarefaAutomaticaDaAgenda(compromisso().id, "definir_proximo_passo");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(c).not.toBe(a);
  });
});
