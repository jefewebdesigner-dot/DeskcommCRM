/**
 * Ação de arquivar continua existindo, mas a navegação operacional do Inbox
 * passa a ter só duas caixas: trabalho vivo e histórico encerrado.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { tabToFilter } from "@/lib/inbox/filtros-do-inbox";

const raiz = process.cwd();
const fonte = (rel: string) => readFileSync(join(raiz, rel), "utf8");

describe("Inbox — histórico encerrado", () => {
  it("Encerrados reúne closed, resolved e archived", () => {
    expect(tabToFilter("ended")).toEqual({
      status: ["closed", "resolved", "archived"],
    });
  });

  it("Em atendimento exclui os estados terminais", () => {
    expect(tabToFilter("open")).toEqual({
      status: ["open", "pending", "claimed", "ai_handling"],
    });
  });

  it("a interface principal oferece somente Em atendimento e Encerrados", () => {
    const filtros = fonte("components/inbox/InboxFilters.tsx");
    expect(filtros).toContain('{ value: "open", label: "Em atendimento" }');
    expect(filtros).toContain('{ value: "ended", label: "Encerrados" }');
    expect(filtros).not.toContain('{ value: "archived", label: "Arquivadas" }');
    expect(filtros).not.toContain('{ value: "closed", label: "Fechadas" }');
  });

  it("deep-links legados de fechadas/arquivadas são absorvidos por Encerrados", () => {
    const layout = fonte("components/inbox/InboxLayout.tsx");
    expect(layout).toContain('v === "ended" || v === "closed" || v === "archived"');
    expect(layout).toContain('return "ended"');
  });
});

describe("compatibilidade da ação de arquivar", () => {
  it("o filtro legado archived continua definido para consumidores internos", () => {
    expect(tabToFilter("archived")).toEqual({ status: "archived" });
  });

  it("a rota de contagem continua publicando closed e archived, além do novo ended", () => {
    const rota = fonte("app/api/v1/conversations/counts/route.ts");
    expect(rota).toMatch(/\.eq\("status",\s*"archived"\)/);
    expect(rota).toMatch(/\.eq\("status",\s*"closed"\)/);
    expect(rota).toMatch(/ended:\s*ended\.count/);
  });

  it("o botão Arquivar continua disponível com confirmação", () => {
    const header = fonte("components/inbox/ConversationHeader.tsx");
    expect(header).toContain('t("Arquivar")');
    expect(header).toContain('t("Arquivar esta conversa?")');
    expect(header).toMatch(/status !== "archived"/);
  });
});
