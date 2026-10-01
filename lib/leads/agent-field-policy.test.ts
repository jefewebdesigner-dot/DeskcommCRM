import { describe, expect, it } from "vitest";

import {
  CHAVE_DE_PROVENIENCIA_DA_IA,
  camposDeclaradosDoFunil,
  decidirAutoPreenchimento,
} from "./agent-field-policy";

const fields = [
  { key: "especialidade_area", label: "Especialidade / área", type: "text" },
  { key: "volume_mensal", label: "Processos / mês", type: "number" },
];

describe("auto-preenchimento de campos do CRM", () => {
  it("só expõe campos declarados pelo funil", () => {
    expect(
      camposDeclaradosDoFunil({
        fields: [
          ...fields,
          { key: CHAVE_DE_PROVENIENCIA_DA_IA, label: "interno", type: "text" },
          { label: "sem chave", type: "text" },
        ],
      }),
    ).toEqual(fields);
  });

  it("preenche campo vazio e registra proveniência da IA", () => {
    const out = decidirAutoPreenchimento({
      fields,
      current: {},
      proposed: { especialidade_area: "Perícia contábil", volume_mensal: "20" },
      agentId: "agent-1",
      nowIso: "2026-10-01T00:00:00.000Z",
    });

    expect(out.atualizados).toEqual(["especialidade_area", "volume_mensal"]);
    expect(out.patch.especialidade_area).toBe("Perícia contábil");
    expect(out.patch.volume_mensal).toBe(20);
    expect(out.patch[CHAVE_DE_PROVENIENCIA_DA_IA]).toMatchObject({
      especialidade_area: { value: "Perícia contábil", agent_id: "agent-1" },
      volume_mensal: { value: 20, agent_id: "agent-1" },
    });
  });

  it("não sobrescreve valor que não pertence à IA", () => {
    const out = decidirAutoPreenchimento({
      fields,
      current: { especialidade_area: "Medicina" },
      proposed: { especialidade_area: "Engenharia" },
      agentId: "agent-1",
      nowIso: "2026-10-01T00:00:00.000Z",
    });

    expect(out.atualizados).toEqual([]);
    expect(out.protegidos).toEqual(["especialidade_area"]);
    expect(out.patch).toEqual({});
  });

  it("permite evoluir valor que a própria IA escreveu", () => {
    const out = decidirAutoPreenchimento({
      fields,
      current: {
        especialidade_area: "Contábil",
        [CHAVE_DE_PROVENIENCIA_DA_IA]: {
          especialidade_area: {
            value: "Contábil",
            updated_at: "2026-09-30T23:00:00.000Z",
            agent_id: "agent-1",
          },
        },
      },
      proposed: { especialidade_area: "Perícia contábil judicial" },
      agentId: "agent-1",
      nowIso: "2026-10-01T00:00:00.000Z",
    });

    expect(out.atualizados).toEqual(["especialidade_area"]);
    expect(out.patch.especialidade_area).toBe("Perícia contábil judicial");
  });

  it("protege o campo se um humano mudou o último valor da IA", () => {
    const out = decidirAutoPreenchimento({
      fields,
      current: {
        especialidade_area: "Contábil e financeira",
        [CHAVE_DE_PROVENIENCIA_DA_IA]: {
          especialidade_area: {
            value: "Contábil",
            updated_at: "2026-09-30T23:00:00.000Z",
            agent_id: "agent-1",
          },
        },
      },
      proposed: { especialidade_area: "Engenharia" },
      agentId: "agent-1",
      nowIso: "2026-10-01T00:00:00.000Z",
    });

    expect(out.atualizados).toEqual([]);
    expect(out.protegidos).toEqual(["especialidade_area"]);
  });

  it("ignora chave que o funil não declarou", () => {
    const out = decidirAutoPreenchimento({
      fields,
      current: {},
      proposed: { cpf: "123" },
      agentId: "agent-1",
      nowIso: "2026-10-01T00:00:00.000Z",
    });

    expect(out.patch).toEqual({});
    expect(out.ignorados).toEqual(["cpf"]);
  });
});
