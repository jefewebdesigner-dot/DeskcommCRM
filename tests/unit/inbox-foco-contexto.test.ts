import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layout = readFileSync("components/inbox/InboxLayout.tsx", "utf8");
const header = readFileSync("components/inbox/ConversationHeader.tsx", "utf8");
const composer = readFileSync("components/inbox/composer/ReplyReviewPanel.tsx", "utf8");

describe("Inbox focado em conversa", () => {
  it("usa duas colunas e mantém o CRM sob demanda", () => {
    expect(layout).toContain("md:grid-cols-[252px_minmax(0,1fr)]");
    expect(layout).toContain('modoFoco && "md:grid-cols-1"');
    expect(layout).not.toContain("xl:grid-cols-[272px_1fr_296px]");
    expect(layout).toContain("open={fichaAberta}");
  });

  it("expõe Contexto e Modo foco sem esconder as ações existentes", () => {
    expect(header).toContain('aria-label={t("Contexto")}');
    expect(header).toContain('t("Modo foco")');
    expect(header).toContain('{t("Transferir")}');
    expect(header).toContain('{t("Fechar")}');
    expect(header).toContain('t("Arquivar")');
  });

  it("a IA compacta quando não existe rascunho para revisar", () => {
    expect(composer).toContain("if (!draft)");
    expect(composer).toContain("IA · Sugerir resposta");
    expect(composer).toContain('className="mb-1.5 flex min-h-7');
  });
});
