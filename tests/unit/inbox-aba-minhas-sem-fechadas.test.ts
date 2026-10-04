import { describe, expect, it, vi } from "vitest";

/**
 * A aba "Minhas" não pode mostrar o que o atendente já fechou.
 *
 * O defeito era a soma de duas decisões que, isoladas, estão certas: a aba
 * filtrava SÓ por dono, e `Fechar` muda o status mas não solta o dono — de
 * propósito, porque quem atendeu é histórico que vale para auditoria e métrica.
 * Juntas, faziam a aba acumular para sempre tudo que a pessoa já atendeu, e o
 * badge contar um trabalho que não existe mais.
 *
 * A correção é na VISTA, não no dado: `exclude_finished` esconde os estados
 * terminais. As fechadas continuam existindo, com dono, na aba Fechadas.
 *
 * Os três elos da corrente são provados separados porque quebram separados:
 * o significado da aba, a serialização para a query string, e o predicado SQL.
 */

import { readFileSync } from "node:fs";
import { tabToFilter } from "@/lib/inbox/filtros-do-inbox";
import { CONVERSATION_TERMINAL_STATUSES, listConversationsQuerySchema } from "@/lib/schemas";

// ---------------------------------------------------------------------------
// elo 1 — o significado da aba
// ---------------------------------------------------------------------------

describe("tabToFilter — o que cada aba significa", () => {
  it("Minhas pede as minhas SEM as terminais", () => {
    expect(tabToFilter("mine")).toEqual({ assigned_to: "me", exclude_finished: true });
  });

  it("Fechadas continua mostrando as fechadas — senão não sobra onde vê-las", () => {
    expect(tabToFilter("closed")).toEqual({ status: "closed" });
  });

  it("a Fila pergunta QUEM MANDA, não o status — e o valor mudou por medição", () => {
    // ESTE `toEqual` MUDOU EM 2026-08-30, e o motivo fica escrito para a próxima
    // sessão não "consertar" de volta.
    //
    // O par anterior (`assigned_to=unassigned` + os dois estados de espera) tinha
    // consertado um defeito real: a conversa escalada é `pending` e sumia de toda
    // aba. Só que ele carregava outro: "sem dono e aberta" é TAMBÉM a conversa
    // que o robô está atendendo agora. Medido na VPS: a Fila mostrava 83 e o
    // automático comandava 47 delas — o atendente via como trabalho seu quase
    // tudo que já estava sendo respondido.
    //
    // `comandosDaFila` responde a pergunta certa e continua cobrindo a conversa
    // escalada (ela é `aguardando`, por causa do silêncio, não do status).
    expect(tabToFilter("unassigned")).toEqual({ comando: ["aguardando"] });
  });

  it("numa org SEM automático, a Fila também traz o que ninguém está atendendo", () => {
    // O controle do caso acima. Sem ele, a Fila de uma instalação recém-instalada
    // — que ainda não publicou agente — nasceria VAZIA com clientes esperando,
    // que é o pior estado possível na primeira impressão.
    expect(tabToFilter("unassigned", false)).toEqual({
      comando: ["aguardando", "automatico"],
    });
  });

  it("a aba do automático pergunta a régua do MOTOR, não `ai_handling`", () => {
    // `ai_handling` é escrito por UM caminho só em produção (a volta pelo botão
    // "Devolver ao automático"), e por isso a aba mostrava 2 enquanto o robô
    // atendia 47.
    expect(tabToFilter("ai")).toEqual({ comando: ["automatico"] });
  });

  it("as outras abas não ganham o filtro de tabela", () => {
    expect(tabToFilter("unassigned").exclude_finished).toBeUndefined();
    expect(tabToFilter("all").exclude_finished).toBeUndefined();
    expect(tabToFilter("ai").exclude_finished).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// elo 2 — a query string
// ---------------------------------------------------------------------------

describe("schema da rota", () => {
  it("aceita exclude_finished", () => {
    const r = listConversationsQuerySchema.safeParse({ exclude_finished: true });
    expect(r.success).toBe(true);
    expect(r.success && r.data.exclude_finished).toBe(true);
  });

  it("sem o parâmetro, fica indefinido — nenhuma aba herda o filtro sem pedir", () => {
    const r = listConversationsQuerySchema.safeParse({});
    expect(r.success && r.data.exclude_finished).toBeUndefined();
  });

  it("os estados terminais são fechada e arquivada", () => {
    expect([...CONVERSATION_TERMINAL_STATUSES]).toEqual(["closed", "archived"]);
  });
});

// ---------------------------------------------------------------------------
// elo 3 — o predicado SQL
// ---------------------------------------------------------------------------

describe("listConversationsHandler — predicado", () => {
  const handler = readFileSync("app/api/v1/conversations/_handler.ts", "utf8");

  it("exclude_finished exclui os terminais no BANCO", () => {
    expect(handler).toContain("if (q.exclude_finished)");
    expect(handler).toContain(
      '.not("status", "in", `(${CONVERSATION_TERMINAL_STATUSES.join(",")})`)',
    );
  });

  it("status e organização continuam sendo predicados server-side", () => {
    expect(handler).toContain('.eq("organization_id", ctx.organization_id)');
    expect(handler).toContain('query = query.in("status", q.status)');
  });
});

// ---------------------------------------------------------------------------
// o badge tem que espelhar a aba
// ---------------------------------------------------------------------------

describe("contador de Minhas", () => {
  it("usa o mesmo conjunto de estados terminais que a aba", () => {
    // Lê a fonte da rota de counts em vez de repetir a string: o que quebra
    // aqui é o badge e a aba discordarem, e um literal duplicado no teste
    // esconderia exatamente isso.
    const fonte = readFileSync("app/api/v1/conversations/counts/route.ts", "utf8");

    expect(fonte).toContain("CONVERSATION_TERMINAL_STATUSES");
    expect(fonte).toMatch(/assigned_to_user_id[\s\S]{0,200}not\(\s*"status"\s*,\s*"in"/);
  });
});

vi.resetModules();
