import type { ConversationsFilters } from "@/hooks/inbox/useConversationsRealtime";
import { comandosDaFila } from "@/lib/inbox/comando-da-conversa";

export type InboxTabAtual = "open" | "ended";
export type LegacyInboxTab = "unassigned" | "mine" | "all" | "closed" | "archived" | "ai";

/**
 * Tradução da intenção visual para filtros de banco.
 *
 * As abas antigas continuam aqui somente como compatibilidade para chamadas
 * internas e testes de contrato; a UI nova expõe apenas open/ended.
 */
export function tabToFilter(
  tab: InboxTabAtual | LegacyInboxTab,
  automaticoDaOrg?: boolean,
): Partial<ConversationsFilters> {
  switch (tab) {
    case "ended":
      return { status: ["closed", "resolved", "archived"] };
    case "open":
      return { status: ["open", "pending", "claimed", "ai_handling"] };
    case "unassigned":
      return { comando: comandosDaFila(automaticoDaOrg) };
    case "mine":
      return { assigned_to: "me", exclude_finished: true };
    case "closed":
      return { status: "closed" };
    case "archived":
      return { status: "archived" };
    case "ai":
      return { comando: ["automatico"] };
    case "all":
    default:
      return {};
  }
}
