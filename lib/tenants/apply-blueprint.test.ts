import { describe, expect, it } from "vitest";

import { erroDeColunaDeAuditoriaDeEtapaAusente, hashBlueprint, stageSemantics } from "./apply-blueprint";
import { salesTwinBlueprintSchema } from "@/lib/schemas/tenant-blueprint";

function sample() {
  return salesTwinBlueprintSchema.parse({
    sales_twin_version: 1,
    deployment_id: "dep-1",
    organization: {
      name: "Clínica A",
      segment: "Clínica",
      summary: "",
      audience: [],
      location: "",
    },
    offer: { primary: "Avaliação", services: ["Botox"], conversion_goal: "Agendar" },
    pipeline: {
      pipeline_name: "Comercial",
      stages: ["Novo lead", "Qualificado", "Fechado", "Perdido"],
      lead_fields: [],
      tags: [],
    },
    agent: {
      name: "Consultor IA",
      objective: "Qualificar e agendar",
      tone: "Consultivo",
      qualification_questions: [],
      handoff_rules: ["Pedido de humano"],
      forbidden_claims: ["Não inventar preços"],
    },
    automations: [],
    tracking: { events: ["lead_submitted"], utm_required: true },
    knowledge: {
      known_facts: ["Atende por avaliação"],
      required_sources: [],
      missing_facts: ["Preços"],
    },
    generated_at: null,
  });
}

describe("Sales Twin blueprint domain", () => {
  it("identifica etapas de ganho/perda sem inventar semântica", () => {
    expect(stageSemantics(["Novo", "Qualificado", "Fechado", "Perdido"])).toEqual({
      wonIndex: 2,
      lostIndex: 3,
    });
    expect(stageSemantics(["Novo", "Contato"])).toEqual({ wonIndex: null, lostIndex: null });
  });

  it("reconhece banco legado sem colunas de auditoria de etapas", () => {
    expect(
      erroDeColunaDeAuditoriaDeEtapaAusente({
        message:
          "Could not find the 'last_change_actor_kind' column of 'crm_stages' in the schema cache",
      }),
    ).toBe(true);
    expect(
      erroDeColunaDeAuditoriaDeEtapaAusente({
        message: "permission denied for table crm_stages",
      }),
    ).toBe(false);
  });

  it("hash é estável para o mesmo Blueprint", () => {
    const a = sample();
    const b = sample();
    expect(hashBlueprint(a)).toBe(hashBlueprint(b));
    b.offer.primary = "Consulta";
    expect(hashBlueprint(a)).not.toBe(hashBlueprint(b));
  });
});
