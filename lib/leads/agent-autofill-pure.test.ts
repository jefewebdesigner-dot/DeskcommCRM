import { describe, expect, it } from "vitest";

import { prepararPatchDeAutopreenchimento } from "@/lib/leads/agent-autofill-pure";

const settings = {
  fields: [
    { key: "especialidade_area", type: "text", label: "Especialidade / área" },
    { key: "cidade_uf", type: "text", label: "Cidade / UF" },
    { key: "volume_mensal", type: "number", label: "Processos / perícias por mês" },
    { key: "data_demo", type: "date", label: "Data da demonstração" },
  ],
};

describe("prepararPatchDeAutopreenchimento", () => {
  it("aceita somente campos declarados e ainda vazios", () => {
    const patch = prepararPatchDeAutopreenchimento({
      settings,
      atuais: { cidade_uf: "Chapecó/SC" },
      propostos: {
        especialidade_area: "Perícia contábil",
        cidade_uf: "Curitiba/PR",
        inventado: "não pode entrar",
      },
    });

    expect(patch).toEqual({ especialidade_area: "Perícia contábil" });
  });

  it("normaliza número textual e preserva a decisão humana", () => {
    const patch = prepararPatchDeAutopreenchimento({
      settings,
      atuais: { especialidade_area: "Engenharia" },
      propostos: {
        especialidade_area: "Contábil",
        volume_mensal: "20,5",
      },
    });

    expect(patch).toEqual({ volume_mensal: 20.5 });
  });

  it("recusa valor complexo e data fora do formato canônico", () => {
    const patch = prepararPatchDeAutopreenchimento({
      settings,
      atuais: {},
      propostos: {
        cidade_uf: { cidade: "Chapecó", uf: "SC" },
        data_demo: "01/10/2026",
      },
    });

    expect(patch).toEqual({});
  });
});
