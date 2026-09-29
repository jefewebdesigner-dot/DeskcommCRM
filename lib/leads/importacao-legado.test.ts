import { describe, expect, it } from "vitest";

import {
  bloqueioDeDisparoDoContato,
  DisparoBloqueadoError,
  ORIGEM_IMPORTACAO_LEGADO,
  TAG_CAMPANHA_LIBERADA,
  TAG_IMPORTACAO_LEGADO,
  TAG_REVISAO_SEM_CONTATO,
} from "@/lib/leads/importacao-legado";

describe("bloqueioDeDisparoDoContato", () => {
  it("contato comum passa", () => {
    expect(bloqueioDeDisparoDoContato({ source: "whatsapp", source_metadata: {}, tags: [] })).toBeNull();
    expect(bloqueioDeDisparoDoContato(null)).toBeNull();
    expect(bloqueioDeDisparoDoContato(undefined)).toBeNull();
  });

  it("qualquer uma das três marcas de importação bloqueia", () => {
    expect(bloqueioDeDisparoDoContato({ source: ORIGEM_IMPORTACAO_LEGADO })).toBe("importacao_legado");
    expect(bloqueioDeDisparoDoContato({ tags: [TAG_IMPORTACAO_LEGADO] })).toBe("importacao_legado");
    expect(bloqueioDeDisparoDoContato({ source_metadata: { importacao_legado: true } })).toBe("importacao_legado");
  });

  it("campanha_liberada abre só a importação", () => {
    expect(
      bloqueioDeDisparoDoContato({ source: ORIGEM_IMPORTACAO_LEGADO, source_metadata: { campanha_liberada: true } }),
    ).toBeNull();
    // valor que não é exatamente `true` não libera
    expect(
      bloqueioDeDisparoDoContato({ source: ORIGEM_IMPORTACAO_LEGADO, source_metadata: { campanha_liberada: "true" } }),
    ).toBe("importacao_legado");
  });

  it("a tag campanha_liberada também abre a importação, mas não a revisão sem contato", () => {
    expect(bloqueioDeDisparoDoContato({ source: ORIGEM_IMPORTACAO_LEGADO, tags: [TAG_CAMPANHA_LIBERADA] })).toBeNull();
    expect(
      bloqueioDeDisparoDoContato({ tags: [TAG_CAMPANHA_LIBERADA, TAG_REVISAO_SEM_CONTATO], source: ORIGEM_IMPORTACAO_LEGADO }),
    ).toBe("revisao_sem_contato");
  });

  it("revisao_sem_contato vence tudo, inclusive campanha liberada", () => {
    expect(
      bloqueioDeDisparoDoContato({
        source: ORIGEM_IMPORTACAO_LEGADO,
        tags: [TAG_REVISAO_SEM_CONTATO],
        source_metadata: { campanha_liberada: true },
      }),
    ).toBe("revisao_sem_contato");
    expect(bloqueioDeDisparoDoContato({ source_metadata: { revisao_sem_contato: true } })).toBe("revisao_sem_contato");
  });

  it("o erro é definitivo e explica o motivo", () => {
    const e = new DisparoBloqueadoError("importacao_legado");
    expect(e.code).toBe("disparo_bloqueado");
    expect(e.motivo).toBe("importacao_legado");
    expect(e.message).toMatch(/importação histórica/);
    expect(new DisparoBloqueadoError("revisao_sem_contato").message).toMatch(/sem meio de contato/);
  });
});
