import { afterEach, describe, expect, it, vi } from "vitest";

import {
  protecaoAgendaSupabase,
  type CompromissoProtetor,
} from "@/lib/agenda/protecao-followup";
import { logger } from "@/lib/logger";

const agora = new Date("2026-10-02T12:00:00Z");
const contatos = Array.from(
  { length: 436 },
  (_, n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
);

function compromisso(id: string, contact: string, futuro = true): CompromissoProtetor {
  return {
    id,
    contact_id: contact,
    revision: 1,
    status: "confirmed",
    starts_at: futuro ? "2099-01-01T12:00:00Z" : "2020-01-01T12:00:00Z",
    ends_at: futuro ? "2099-01-01T13:00:00Z" : "2020-01-01T13:00:00Z",
  };
}

function banco(
  appointments: CompromissoProtetor[],
  options: { maxRows?: number; falharContato?: string } = {},
) {
  const consultas: Array<{ contatos: string[]; cursor: string; quantidade: number }> = [];
  const db = {
    from: (table: string) => {
      let ids: string[] = [];
      let cursor = "";
      let org = "";
      const query = {
        select: () => query,
        eq: (key: string, value: string) => {
          if (key === "organization_id" || key === "id") org = value;
          return query;
        },
        in: (key: string, values: string[]) => {
          if (key === "contact_id") ids = values;
          return query;
        },
        order: () => query,
        limit: () => query,
        gt: (_key: string, value: string) => {
          cursor = value;
          return query;
        },
        single: async () => ({ data: { settings: {} }, error: null }),
        then: (resolve: (value: unknown) => unknown) => {
          expect(table).toBe("calendar_appointments");
          expect(org).toBe("org-pericia");
          const rows = appointments
            .filter((row) => ids.includes(row.contact_id!) && row.id > cursor)
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, options.maxRows ?? 500);
          consultas.push({ contatos: [...ids], cursor, quantidade: rows.length });
          const falhou =
            ids.length > 100 ||
            (options.falharContato !== undefined && ids.includes(options.falharContato));
          return Promise.resolve(
            falhou
              ? { data: null, error: { message: "fetch failed" } }
              : { data: rows, error: null },
          ).then(resolve);
        },
      };
      return query;
    },
  };
  return { db, consultas };
}

afterEach(() => vi.restoreAllMocks());

describe("Radar consulta agenda de muitos contatos sem exceder a URL do Data API", () => {
  it("436 contatos: preserva o compromisso do último lote e a ausência nos demais", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    const ultimo = contatos[435]!;
    const { db, consultas } = banco([compromisso("agenda-final", ultimo)]);

    const resultado = await protecaoAgendaSupabase(db as never, "org-pericia", contatos, agora);

    expect(resultado.size).toBe(436);
    expect(resultado.get(ultimo)).toMatchObject({
      adiar: true,
      motivo: "agendado",
      appointment_id: "agenda-final",
    });
    expect(resultado.get(contatos[0]!)).toMatchObject({ adiar: false, motivo: "sem_compromisso" });
    expect(consultas.every((consulta) => consulta.contatos.length <= 100)).toBe(true);
    expect(new Set(consultas.flatMap((consulta) => consulta.contatos)).size).toBe(436);
  });

  it("continua páginas menores que 500 e reinicia o cursor para cada lote", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    const primeiro = contatos[0]!;
    const ultimo = contatos[435]!;
    const { db, consultas } = banco(
      [
        compromisso("z001", primeiro, false),
        compromisso("z002", primeiro, false),
        compromisso("z003", primeiro),
        compromisso("a001", ultimo, false),
        compromisso("a002", ultimo, false),
        compromisso("a003", ultimo),
      ],
      { maxRows: 2 },
    );

    const resultado = await protecaoAgendaSupabase(db as never, "org-pericia", contatos, agora);

    expect(resultado.get(primeiro)).toMatchObject({ adiar: true, appointment_id: "z003" });
    expect(resultado.get(ultimo)).toMatchObject({ adiar: true, appointment_id: "a003" });
    for (const contact of [primeiro, ultimo]) {
      const paginas = consultas.filter((consulta) => consulta.contatos.includes(contact));
      expect(paginas.map((pagina) => pagina.quantidade)).toEqual([2, 1, 0]);
      expect(paginas[0]!.cursor).toBe("");
    }
  });

  it("falha em lote posterior invalida a leitura inteira, inclusive contatos já lidos", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { db, consultas } = banco([compromisso("agenda-inicial", contatos[0]!)], {
      falharContato: contatos[435],
    });

    const resultado = await protecaoAgendaSupabase(db as never, "org-pericia", contatos, agora);

    expect(consultas.some((consulta) => consulta.contatos.includes(contatos[435]!))).toBe(true);
    expect(resultado.size).toBe(436);
    for (const protection of resultado.values()) {
      expect(protection).toMatchObject({
        adiar: true,
        motivo: "leitura_indisponivel",
        appointment_id: null,
        reavaliar_em: "2026-10-02T12:01:00.000Z",
      });
    }
  });
});
