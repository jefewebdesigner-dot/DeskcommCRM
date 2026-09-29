import { beforeEach, describe, expect, it, vi } from "vitest";

const protecaoSupabase = vi.fn();
const protecaoPg = vi.fn();
vi.mock("./protecao-followup", () => ({
  AgendaDeferredError: class AgendaDeferredError extends Error {
    constructor(readonly protection: unknown) { super("adiado"); }
  },
  indisponivel: () => ({ adiar: true, motivo: "leitura_indisponivel", appointment_id: null, reavaliar_em: null }),
  protecaoAgendaSupabase: (...a: unknown[]) => protecaoSupabase(...a),
  protecaoAgendaPg: (...a: unknown[]) => protecaoPg(...a),
}));

import { assertAgendaEffectPg, assertAgendaEffectSupabase } from "./efeito";
import { DisparoBloqueadoError } from "@/lib/leads/importacao-legado";

const CTX = { organizationId: "org-1", contactId: "c-1" };

function supabaseCom(contato: unknown, erro: unknown = null) {
  const cadeia: Record<string, unknown> = {};
  cadeia.select = () => cadeia;
  cadeia.eq = () => cadeia;
  cadeia.maybeSingle = async () => ({ data: contato, error: erro });
  return { from: (t: string) => { expect(t).toBe("contacts"); return cadeia; } } as never;
}

beforeEach(() => {
  protecaoSupabase.mockReset().mockResolvedValue(new Map([["c-1", { adiar: false }]]));
  protecaoPg.mockReset().mockResolvedValue({ adiar: false });
});

describe("portão dos envios proativos — importação histórica (Supabase)", () => {
  it("bloqueia contato importado ANTES de consultar a agenda", async () => {
    const db = supabaseCom({ source: "periciaia_legado", source_metadata: {}, tags: ["importacao_legado"] });
    await expect(assertAgendaEffectSupabase(db, CTX)).rejects.toBeInstanceOf(DisparoBloqueadoError);
    expect(protecaoSupabase).not.toHaveBeenCalled();
  });

  it("bloqueia quem está em revisão sem contato, mesmo com campanha liberada", async () => {
    const db = supabaseCom({ source: "periciaia_legado", source_metadata: { campanha_liberada: true }, tags: ["revisao_sem_contato"] });
    await expect(assertAgendaEffectSupabase(db, CTX)).rejects.toMatchObject({ motivo: "revisao_sem_contato" });
  });

  it("contato comum e importado com campanha liberada seguem para a proteção da agenda", async () => {
    await expect(assertAgendaEffectSupabase(supabaseCom({ source: "whatsapp", source_metadata: {}, tags: [] }), CTX)).resolves.toBeUndefined();
    await expect(
      assertAgendaEffectSupabase(supabaseCom({ source: "periciaia_legado", source_metadata: { campanha_liberada: true }, tags: [] }), CTX),
    ).resolves.toBeUndefined();
    expect(protecaoSupabase).toHaveBeenCalledTimes(2);
  });

  it("fail-closed: falha na leitura do contato ADIA (leitura_indisponivel) e nada segue", async () => {
    const db = supabaseCom(null, new Error("leitura indisponível"));
    await expect(assertAgendaEffectSupabase(db, CTX)).rejects.toMatchObject({ protection: { motivo: "leitura_indisponivel" } });
    expect(protecaoSupabase).not.toHaveBeenCalled();
  });
});

describe("portão dos envios proativos — importação histórica (Pg)", () => {
  const pgCom = (rows: unknown[]) => ({ query: vi.fn(async () => ({ rows })) }) as never;

  it("bloqueia contato importado", async () => {
    const db = pgCom([{ source: "periciaia_legado", source_metadata: {}, tags: [] }]);
    await expect(assertAgendaEffectPg(db, CTX)).rejects.toBeInstanceOf(DisparoBloqueadoError);
    expect(protecaoPg).not.toHaveBeenCalled();
  });

  it("contato comum segue para a proteção da agenda", async () => {
    await expect(assertAgendaEffectPg(pgCom([{ source: "manual", source_metadata: {}, tags: [] }]), CTX)).resolves.toBeUndefined();
    expect(protecaoPg).toHaveBeenCalledTimes(1);
  });

  it("fail-closed: falha na leitura do contato ADIA e nada segue", async () => {
    const db = { query: vi.fn(async () => { throw new Error("database unavailable"); }) } as never;
    await expect(assertAgendaEffectPg(db, CTX)).rejects.toMatchObject({ protection: { motivo: "leitura_indisponivel" } });
    expect(protecaoPg).not.toHaveBeenCalled();
  });
});
