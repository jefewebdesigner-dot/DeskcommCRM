import type { WahaClient } from "@/lib/waha/client";
import type { Admin } from "@/lib/waha/ingest";
import {
  parseChatId,
  persistirMensagemHistoricaWaha,
  type ResultadoDaMensagemHistorica,
} from "@/lib/waha/ingest";
import { payloadHistoricoDoStore } from "@/lib/waha/history-normalization";

type Objeto = Record<string, unknown>;

function objeto(v: unknown): Objeto {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Objeto) : {};
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export interface ResumoDoHistoricoWaha {
  chats_vistos: number;
  chats_importados: number;
  mensagens_vistas: number;
  mensagens_inseridas: number;
  mensagens_duplicadas: number;
  mensagens_ignoradas: number;
}

export interface OpcoesDoHistoricoWaha {
  chatPageSize?: number;
  messagePageSize?: number;
  maxChats?: number;
  onProgress?: (progress: ResumoDoHistoricoWaha) => void;
}

function chatDoStore(raw: unknown): { id: string; name: string | null } | null {
  const row = objeto(raw);
  const id = texto(row.id);
  if (!id) return null;

  const interno = objeto(row._chat);
  const name =
    texto(row.name) ??
    texto(interno.name) ??
    texto(interno.notify) ??
    texto(interno.pushName) ??
    null;

  return { id, name };
}

/**
 * Importa o store do WAHA para o Inbox sem executar efeitos operacionais.
 *
 * A idempotência vem do unique (organization_id, external_id) em messages e das
 * RPCs canônicas de contato/conversa. Reexecutar é seguro e é o mecanismo de
 * retomada depois de queda/restart.
 */
export async function sincronizarHistoricoWaha(
  admin: Admin,
  waha: WahaClient,
  session: { id: string; organization_id: string; waha_session_name: string },
  opts: OpcoesDoHistoricoWaha = {},
): Promise<ResumoDoHistoricoWaha> {
  const chatPageSize = Math.min(Math.max(opts.chatPageSize ?? 100, 1), 250);
  const messagePageSize = Math.min(Math.max(opts.messagePageSize ?? 200, 1), 500);
  const maxChats = opts.maxChats ?? Number.POSITIVE_INFINITY;

  const resumo: ResumoDoHistoricoWaha = {
    chats_vistos: 0,
    chats_importados: 0,
    mensagens_vistas: 0,
    mensagens_inseridas: 0,
    mensagens_duplicadas: 0,
    mensagens_ignoradas: 0,
  };

  let chatOffset = 0;
  while (resumo.chats_vistos < maxChats) {
    const chats = await waha.listChats(session.waha_session_name, {
      limit: Math.min(chatPageSize, maxChats - resumo.chats_vistos),
      offset: chatOffset,
    });
    if (chats.length === 0) break;

    for (const rawChat of chats) {
      if (resumo.chats_vistos >= maxChats) break;
      resumo.chats_vistos += 1;

      const chat = chatDoStore(rawChat);
      if (!chat) continue;
      const identity = parseChatId(chat.id);
      if (identity.kind === "group" || identity.kind === "unknown") continue;

      let offset = 0;
      let importouChat = false;
      while (true) {
        const mensagens = await waha.listChatMessages(
          session.waha_session_name,
          chat.id,
          {
            limit: messagePageSize,
            offset,
            // O primeiro backfill não baixa anos de mídia para a VPS. O registro
            // conserva tipo/id e texto; mídia antiga pode ser hidratada sob
            // demanda numa etapa separada.
            downloadMedia: false,
          },
        );
        if (mensagens.length === 0) break;

        for (const rawMessage of mensagens) {
          resumo.mensagens_vistas += 1;
          const payload = payloadHistoricoDoStore(rawMessage);
          if (!payload) {
            resumo.mensagens_ignoradas += 1;
            continue;
          }
          const result: ResultadoDaMensagemHistorica =
            await persistirMensagemHistoricaWaha(admin, session, {
              chatId: chat.id,
              chatName: chat.name,
              payload,
            });
          if (result === "inserted") {
            resumo.mensagens_inseridas += 1;
            importouChat = true;
          } else if (result === "duplicate") {
            resumo.mensagens_duplicadas += 1;
            importouChat = true;
          } else {
            resumo.mensagens_ignoradas += 1;
          }
        }

        offset += mensagens.length;
        if (mensagens.length < messagePageSize) break;
      }

      if (importouChat) resumo.chats_importados += 1;
      opts.onProgress?.({ ...resumo });
    }

    chatOffset += chats.length;
    if (chats.length < chatPageSize) break;
  }

  return resumo;
}
