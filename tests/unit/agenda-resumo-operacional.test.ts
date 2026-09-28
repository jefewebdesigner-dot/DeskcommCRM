import { describe, expect, it } from "vitest";

import { resumirAgendaOperacional } from "@/components/agenda/ResumoOperacionalDaAgenda";
import type { Agendamento } from "@/components/agenda/tipos";

const AGORA = new Date("2026-09-28T12:00:00.000Z");

function compromisso(
  id: string,
  comeca: string,
  termina: string,
  situacao: Agendamento["situacao"] = "confirmed",
  origem: Agendamento["origem"] = "ui",
): Agendamento {
  return {
    id,
    titulo: id,
    responsavelId: "u-1",
    comeca,
    termina,
    origem,
    situacao,
  };
}

describe("resumo operacional da Agenda", () => {
  it("conta hoje, próximos 7 dias, pendências atrasadas e sem confirmação", () => {
    const resumo = resumirAgendaOperacional(
      [
        compromisso("hoje", "2026-09-28T14:00:00.000Z", "2026-09-28T15:00:00.000Z"),
        compromisso("amanha", "2026-09-29T14:00:00.000Z", "2026-09-29T15:00:00.000Z"),
        compromisso("pendente", "2026-09-30T14:00:00.000Z", "2026-09-30T15:00:00.000Z", "pending"),
        compromisso("passado", "2026-09-27T10:00:00.000Z", "2026-09-27T11:00:00.000Z"),
      ],
      AGORA,
    );

    expect(resumo.hoje).toBe(1);
    expect(resumo.proximosSeteDias).toBe(3);
    expect(resumo.semConfirmacao).toBe(1);
    expect(resumo.atrasados).toBe(1);
  });

  it("prioriza confirmação vencida antes de resultado pendente e confirmação futura", () => {
    const resumo = resumirAgendaOperacional(
      [
        compromisso("futuro", "2026-09-29T10:00:00.000Z", "2026-09-29T11:00:00.000Z", "pending"),
        compromisso("resultado", "2026-09-27T10:00:00.000Z", "2026-09-27T11:00:00.000Z"),
        compromisso("vencida", "2026-09-27T08:00:00.000Z", "2026-09-27T09:00:00.000Z", "pending"),
      ],
      AGORA,
    );

    expect(resumo.prioridades.map((p) => [p.agendamento.id, p.motivo])).toEqual([
      ["vencida", "confirmacao_vencida"],
      ["resultado", "resultado_pendente"],
      ["futuro", "aguardando_confirmacao"],
    ]);
  });

  it("não transforma ocupação externa nem compromisso encerrado em trabalho da equipe", () => {
    const resumo = resumirAgendaOperacional(
      [
        compromisso("google", "2026-09-28T08:00:00.000Z", "2026-09-28T09:00:00.000Z", "confirmed", "google_sync"),
        compromisso("concluido", "2026-09-27T08:00:00.000Z", "2026-09-27T09:00:00.000Z", "completed"),
        compromisso("cancelado", "2026-09-29T08:00:00.000Z", "2026-09-29T09:00:00.000Z", "cancelled"),
      ],
      AGORA,
    );

    expect(resumo).toMatchObject({ hoje: 0, proximosSeteDias: 0, semConfirmacao: 0, atrasados: 0 });
    expect(resumo.prioridades).toHaveLength(0);
  });
});
