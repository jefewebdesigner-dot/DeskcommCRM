import { describe, expect, it, vi } from "vitest";

import { enrollFollowupFlow } from "@/lib/followup/enroll";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

// Só as duas primeiras leituras importam aqui: o fluxo ativo e o contato. A
// inscrição precisa ser recusada na segunda, antes de qualquer fila.
function supabaseFalso(contato: unknown) {
  const tabelas: string[] = [];
  const from = (tabela: string) => {
    tabelas.push(tabela);
    const cadeia: Record<string, unknown> = {};
    cadeia.select = () => cadeia;
    cadeia.eq = () => cadeia;
    cadeia.maybeSingle = async () => ({
      data: tabela === "followup_flow_pointers" ? { id: "p-1", status: "active", active_version_id: "v-1" } : contato,
      error: null,
    });
    return cadeia;
  };
  return { db: { from } as never, tabelas };
}

const ENTRADA = { organizationId: "org-1", pointerId: "p-1", contactId: "c-1", actorUserId: null, requestId: "r-1" };

describe("enrollFollowupFlow — importação histórica", () => {
  it("recusa contato importado com 409 e não chega a ler a versão do fluxo", async () => {
    const { db, tabelas } = supabaseFalso({ id: "c-1", source: "periciaia_legado", source_metadata: {}, tags: [] });
    const r = await enrollFollowupFlow(db, ENTRADA);
    expect(r).toMatchObject({ ok: false, code: "disparo_bloqueado", status: 409 });
    expect(tabelas).not.toContain("followup_flow_versions");
  });

  it("recusa quem está em revisão sem contato", async () => {
    const { db } = supabaseFalso({ id: "c-1", source: "manual", source_metadata: {}, tags: ["revisao_sem_contato"] });
    expect(await enrollFollowupFlow(db, ENTRADA)).toMatchObject({ ok: false, code: "disparo_bloqueado" });
  });
});
