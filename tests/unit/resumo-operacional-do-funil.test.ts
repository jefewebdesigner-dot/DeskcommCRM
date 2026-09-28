import { describe, expect, it } from "vitest";

import { resumirFunil } from "@/components/kanban/ResumoOperacionalDoFunil";
import type { Lead } from "@/lib/types/leads";

function lead(
  id: string,
  patch: Partial<Lead> = {},
): Lead {
  return {
    id,
    organization_id: "org",
    pipeline_id: "funil",
    stage_id: "etapa",
    contact_id: null,
    title: id,
    description: null,
    status: "open",
    lost_reason: null,
    position_in_stage: 1,
    value_cents: null,
    currency: "BRL",
    owner_user_id: "usuario",
    owner_kind: "user",
    owner_agent_id: null,
    assigned_at: null,
    last_activity_at: null,
    expected_close_date: null,
    closed_at: null,
    source: "manual",
    source_metadata: {},
    external_id: null,
    custom_fields: {},
    tags: [],
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-01T10:00:00.000Z",
    created_by_user_id: null,
    ...patch,
  };
}

describe("resumo operacional do funil", () => {
  it("resume volume, risco, falta de dono e prazo vencido sem contar negócio fechado", () => {
    const resumo = resumirFunil(
      [
        lead("a", { value_cents: 100_00, expected_close_date: "2026-09-27" }),
        lead("b", { value_cents: 250_00, owner_user_id: null, owner_kind: null }),
        lead("c", { status: "won", value_cents: 999_00 }),
      ],
      new Set(["a"]),
      new Date("2026-09-28T12:00:00.000Z"),
    );

    expect(resumo).toMatchObject({
      abertos: 2,
      emRisco: 1,
      semResponsavel: 1,
      prazoVencido: 1,
    });
    expect(resumo.valores).toEqual([{ moeda: "BRL", centavos: 350_00 }]);
  });

  it("não mistura moedas diferentes numa soma falsa", () => {
    const resumo = resumirFunil(
      [
        lead("real", { value_cents: 100_00, currency: "BRL" }),
        lead("dolar", { value_cents: 50_00, currency: "USD" }),
      ],
      new Set(),
      new Date("2026-09-28T12:00:00.000Z"),
    );

    expect(resumo.valores).toEqual([
      { moeda: "BRL", centavos: 100_00 },
      { moeda: "USD", centavos: 50_00 },
    ]);
  });

  it("considera dono agente como responsável", () => {
    const resumo = resumirFunil(
      [lead("ia", { owner_user_id: null, owner_kind: "ai", owner_agent_id: "agente" })],
      new Set(),
    );
    expect(resumo.semResponsavel).toBe(0);
  });
});
