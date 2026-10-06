import { describe, expect, it } from "vitest";
import { etapasParaMover, posicaoNoFimDaEtapa } from "./mover-de-etapa";
import type { Stage } from "@/lib/kanban/types";

const lead = (id: string, stage_id: string, position_in_stage: number | null) => ({
  id,
  stage_id,
  position_in_stage,
});

describe("posicaoNoFimDaEtapa", () => {
  it("etapa vazia começa no primeiro passo", () => {
    expect(posicaoNoFimDaEtapa([], "a")).toBeGreaterThan(0);
  });

  it("vai para depois do último da etapa", () => {
    const leads = [lead("1", "a", 1000), lead("2", "a", 3000), lead("3", "b", 9000)];
    expect(posicaoNoFimDaEtapa(leads, "a")).toBeGreaterThan(3000);
  });

  it("ignora o próprio negócio que está sendo movido", () => {
    const leads = [lead("1", "a", 1000), lead("2", "a", 9000)];
    expect(posicaoNoFimDaEtapa(leads, "a", "2")).toBeLessThan(9000);
  });

  it("posição nula não derruba a conta", () => {
    expect(posicaoNoFimDaEtapa([lead("1", "a", null)], "a")).toBeGreaterThan(0);
  });
});

describe("etapasParaMover", () => {
  const e = (id: string, position: number, extra: Partial<Stage> = {}) =>
    ({ id, name: id, position, is_won: false, is_lost: false, is_archived: false, ...extra }) as Stage;

  it("tira arquivadas e a de perdido, mantém ordem", () => {
    const r = etapasParaMover(
      [e("c", 3), e("perdido", 4, { is_lost: true }), e("a", 1), e("arq", 2, { is_archived: true })],
      "a",
    );
    expect(r.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("mantém a etapa atual mesmo se for perdido", () => {
    const r = etapasParaMover([e("a", 1), e("perdido", 2, { is_lost: true })], "perdido");
    expect(r.map((s) => s.id)).toEqual(["a", "perdido"]);
  });
});
