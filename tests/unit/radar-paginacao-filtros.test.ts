import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { carregaRadarDeRisco } from "@/lib/leads/radar-de-risco";

vi.mock("@/lib/agenda/protecao-followup", () => ({
  protecaoAgendaSupabase: async () => new Map(),
}));

const ORG = "org-radar";
const AGORA = new Date("2026-10-02T12:00:00.000Z");

type Linha = Record<string, unknown>;

function bancoFalso(tabelas: Record<string, Linha[]>): SupabaseClient {
  const from = (tabela: string) => {
    let linhas = [...(tabelas[tabela] ?? [])];
    const chain = {
      select: () => chain,
      eq: (col: string, val: unknown) => ((linhas = linhas.filter((l) => l[col] === val)), chain),
      is: (col: string, val: unknown) => ((linhas = linhas.filter((l) => (l[col] ?? null) === val)), chain),
      in: (col: string, vals: unknown[]) => ((linhas = linhas.filter((l) => vals.includes(l[col]))), chain),
      gt: (col: string, val: unknown) =>
        ((linhas = linhas.filter((l) => String(l[col] ?? "") > String(val))), chain),
      not: (col: string, op: string, lista: string) => {
        if (op !== "in") throw new Error(`operador não suportado: ${op}`);
        const vals = lista.replace(/^\(|\)$/g, "").split(",");
        linhas = linhas.filter((l) => !vals.includes(String(l[col])));
        return chain;
      },
      order: () => chain,
      limit: (n: number) => ((linhas = linhas.slice(0, n)), chain),
      maybeSingle: async () => ({ data: linhas[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: linhas, error: null }).then(resolve),
    };
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}

function lead(
  id: string,
  when: string,
  opts: {
    contact_id?: string | null;
    owner_user_id?: string | null;
    owner_kind?: "user" | "ai" | null;
  } = {},
): Linha {
  return {
    id,
    organization_id: ORG,
    status: "open",
    title: id,
    pipeline_id: "p1",
    stage_id: null,
    contact_id: opts.contact_id ?? null,
    owner_user_id: opts.owner_user_id ?? null,
    owner_kind: opts.owner_kind ?? null,
    owner_agent_id: null,
    last_activity_at: when,
    created_at: when,
  };
}

function banco(): SupabaseClient {
  return bancoFalso({
    crm_pipelines: [{ id: "p1", organization_id: ORG, is_archived: false }],
    crm_leads: [
      lead("critico-mais-antigo", "2026-09-20T12:00:00.000Z"),
      lead("critico-com-dono", "2026-09-25T12:00:00.000Z", {
        owner_user_id: "u1",
        owner_kind: "user",
      }),
      lead("em-risco", "2026-09-30T12:00:00.000Z"),
      lead("em-voo", "2026-09-30T12:00:00.000Z", { contact_id: "c4" }),
    ],
    crm_stages: [],
    ai_agents: [],
    contacts: [
      {
        id: "c4",
        organization_id: ORG,
        name: "Contato 4",
        display_name: "Contato 4",
      },
    ],
    conversations: [],
    cron_jobs: [
      {
        organization_id: ORG,
        contact_id: "c4",
        kind: "at",
        enabled: true,
        next_run_at: "2026-10-03T12:00:00.000Z",
      },
    ],
    demandas: [],
  });
}

describe("Radar operacional: paginação e filtros", () => {
  it("pagina depois de classificar e ordenar, sem perder o total", async () => {
    const r = await carregaRadarDeRisco(banco(), {
      organizationId: ORG,
      now: AGORA,
      limit: 2,
      offset: 1,
    });

    expect(r.total).toBe(4);
    expect(r.items).toHaveLength(2);
    expect(r.items.map((x) => x.id)).toEqual(["critico-com-dono", "em-risco"]);
  });

  it("filtra criticidade antes da paginação", async () => {
    const r = await carregaRadarDeRisco(banco(), {
      organizationId: ORG,
      now: AGORA,
      limit: 1,
      offset: 1,
      risks: ["critico"],
    });

    expect(r.total).toBe(2);
    expect(r.items.map((x) => x.id)).toEqual(["critico-com-dono"]);
  });

  it("separa sem dono e com responsável pela mesma regra exibida na tela", async () => {
    const semDono = await carregaRadarDeRisco(banco(), {
      organizationId: ORG,
      now: AGORA,
      ownership: "unassigned",
    });
    const comDono = await carregaRadarDeRisco(banco(), {
      organizationId: ORG,
      now: AGORA,
      ownership: "owned",
    });

    expect(semDono.total).toBe(3);
    expect(semDono.items.map((x) => x.id)).not.toContain("critico-com-dono");
    expect(comDono.total).toBe(1);
    expect(comDono.items.map((x) => x.id)).toEqual(["critico-com-dono"]);
  });
});
