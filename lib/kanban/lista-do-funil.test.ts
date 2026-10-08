import { describe, expect, it } from "vitest";
import { haQuantoTempo, ordenarParaAtendimento } from "./lista-do-funil";

const AGORA = Date.parse("2026-10-06T12:00:00Z");
const lead = (
  id: string,
  extra: {
    unread?: number;
    ultima?: string;
    tarefaEm?: string;
    pos?: number;
  } = {},
) => ({
  id,
  position_in_stage: extra.pos ?? 1000,
  conversa: extra.unread !== undefined || extra.ultima
    ? { id: `c-${id}`, preview: null, last_message_at: extra.ultima ?? null, unread: extra.unread ?? 0 }
    : null,
  next_operation: extra.tarefaEm
    ? { id: `t-${id}`, kind: "task" as const, label: "x", at: extra.tarefaEm }
    : null,
});

describe("ordenarParaAtendimento", () => {
  it("quem escreveu e não foi lido vem antes de tudo", () => {
    const r = ordenarParaAtendimento(
      [lead("a", { tarefaEm: "2026-10-05T00:00:00Z" }), lead("b", { unread: 2 })],
      AGORA,
    );
    expect(r.map((l) => l.id)).toEqual(["b", "a"]);
  });

  it("tarefa vencida vem antes de quem só tem conversa antiga", () => {
    const r = ordenarParaAtendimento(
      [lead("a", { ultima: "2026-10-06T11:00:00Z" }), lead("b", { tarefaEm: "2026-10-05T00:00:00Z" })],
      AGORA,
    );
    expect(r.map((l) => l.id)).toEqual(["b", "a"]);
  });

  it("tarefa futura não conta como vencida", () => {
    const r = ordenarParaAtendimento(
      [lead("a", { ultima: "2026-10-06T11:00:00Z" }), lead("b", { tarefaEm: "2026-10-07T00:00:00Z" })],
      AGORA,
    );
    expect(r.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("entre iguais, o contato mais recente primeiro", () => {
    const r = ordenarParaAtendimento(
      [lead("a", { ultima: "2026-10-01T00:00:00Z" }), lead("b", { ultima: "2026-10-05T00:00:00Z" })],
      AGORA,
    );
    expect(r.map((l) => l.id)).toEqual(["b", "a"]);
  });

  it("sem nenhum sinal, mantém a posição do quadro e é estável", () => {
    const r = ordenarParaAtendimento([lead("b", { pos: 2000 }), lead("a", { pos: 1000 })], AGORA);
    expect(r.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("não altera o array recebido", () => {
    const entrada = [lead("b", { pos: 2 }), lead("a", { pos: 1 })];
    ordenarParaAtendimento(entrada, AGORA);
    expect(entrada.map((l) => l.id)).toEqual(["b", "a"]);
  });
});

describe("haQuantoTempo", () => {
  it("formata em minutos, horas e dias", () => {
    expect(haQuantoTempo("2026-10-06T11:55:00Z", AGORA)).toBe("há 5 min");
    expect(haQuantoTempo("2026-10-06T09:00:00Z", AGORA)).toBe("há 3 h");
    expect(haQuantoTempo("2026-10-01T12:00:00Z", AGORA)).toBe("há 5 d");
  });
  it("sem data devolve null, nunca 'NaN'", () => {
    expect(haQuantoTempo(null, AGORA)).toBeNull();
    expect(haQuantoTempo("lixo", AGORA)).toBeNull();
  });
});
