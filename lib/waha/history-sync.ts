import type { WahaClient } from "@/lib/waha/client";
import type { Admin } from "@/lib/waha/ingest";
import {
  mediaMimeOf,
  mediaUrlOf,
  parseChatId,
  persistirMensagemHistoricaWaha,
  resolveMessageType,
  type ResultadoDaMensagemHistorica,
} from "@/lib/waha/ingest";
import { payloadHistoricoDoStore } from "@/lib/waha/history-normalization";

type Objeto = Record<string, unknown>;

const TIPOS_COM_BINARIO = new Set([
  "audio",
  "image",
  "video",
  "document",
  "sticker",
]);

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
  /** Offset inicial de chats para permitir backfill em lotes do worker. */
  startChatOffset?: number;
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

  let chatOffset = Math.max(0, Math.trunc(opts.startChatOffset ?? 0));
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
            // A primeira fase não baixa anos de mídia para a VPS. O registro
            // conserva tipo/id e texto; a segunda fase hidrata anexos em lotes
            // pequenos, depois que todo o histórico textual já existe.
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

export interface ResumoDaMidiaHistoricaWaha {
  chats_vistos: number;
  mensagens_vistas: number;
  midias_encontradas: number;
  midias_enfileiradas: number;
  midias_ja_persistidas: number;
  midias_indisponiveis: number;
  mensagens_sem_linha: number;
  next_chat_offset: number | null;
  next_message_offset: number | null;
  completed: boolean;
}

export interface OpcoesDaMidiaHistoricaWaha {
  startChatOffset?: number;
  startMessageOffset?: number;
  scanPageSize?: number;
  maxMedia?: number;
  maxMessagesScanned?: number;
}

interface LinhaDeMidiaHistorica {
  id: string;
  media_url: string | null;
  media_mime: string | null;
  media_storage_path: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Segunda fase do backfill: hidrata anexos antigos sem disparar efeitos
 * operacionais.
 *
 * O cursor é mensagem-a-mensagem. Isso permite limitar quantos binários entram
 * em cada job sem pular os anexos que ficaram depois do último processado na
 * mesma página do WAHA.
 */
export async function hidratarMidiaHistoricaWaha(
  admin: Admin,
  waha: WahaClient,
  session: { id: string; organization_id: string; waha_session_name: string },
  opts: OpcoesDaMidiaHistoricaWaha = {},
): Promise<ResumoDaMidiaHistoricaWaha> {
  const scanPageSize = Math.min(Math.max(opts.scanPageSize ?? 100, 1), 200);
  const maxMedia = Math.min(Math.max(opts.maxMedia ?? 5, 1), 20);
  const maxMessagesScanned = Math.min(
    Math.max(opts.maxMessagesScanned ?? 500, scanPageSize),
    2_000,
  );

  let chatOffset = Math.max(0, Math.trunc(opts.startChatOffset ?? 0));
  let messageOffset = Math.max(0, Math.trunc(opts.startMessageOffset ?? 0));

  const resumo: ResumoDaMidiaHistoricaWaha = {
    chats_vistos: 0,
    mensagens_vistas: 0,
    midias_encontradas: 0,
    midias_enfileiradas: 0,
    midias_ja_persistidas: 0,
    midias_indisponiveis: 0,
    mensagens_sem_linha: 0,
    next_chat_offset: chatOffset,
    next_message_offset: messageOffset,
    completed: false,
  };

  while (resumo.mensagens_vistas < maxMessagesScanned) {
    const chats = await waha.listChats(session.waha_session_name, {
      limit: 1,
      offset: chatOffset,
    });
    if (chats.length === 0) {
      resumo.next_chat_offset = null;
      resumo.next_message_offset = null;
      resumo.completed = true;
      return resumo;
    }

    const chat = chatDoStore(chats[0]);
    if (!chat) {
      chatOffset += 1;
      messageOffset = 0;
      resumo.chats_vistos += 1;
      continue;
    }

    const identity = parseChatId(chat.id);
    if (identity.kind === "group" || identity.kind === "unknown") {
      chatOffset += 1;
      messageOffset = 0;
      resumo.chats_vistos += 1;
      continue;
    }

    const restante = maxMessagesScanned - resumo.mensagens_vistas;
    const mensagens = await waha.listChatMessages(
      session.waha_session_name,
      chat.id,
      {
        limit: Math.min(scanPageSize, restante),
        offset: messageOffset,
        downloadMedia: false,
      },
    );

    if (mensagens.length === 0) {
      chatOffset += 1;
      messageOffset = 0;
      resumo.chats_vistos += 1;
      continue;
    }

    for (let i = 0; i < mensagens.length; i += 1) {
      resumo.mensagens_vistas += 1;
      const payload = payloadHistoricoDoStore(mensagens[i]);
      if (!payload?.id) continue;
      const tipo = resolveMessageType(payload);
      if (!TIPOS_COM_BINARIO.has(tipo) && !mediaUrlOf(payload)) continue;

      resumo.midias_encontradas += 1;
      const { data: linhaRaw, error: linhaErr } = await admin
        .from("messages")
        .select("id,media_url,media_mime,media_storage_path,metadata")
        .eq("organization_id", session.organization_id)
        .eq("channel_session_id", session.id)
        .eq("external_id", payload.id)
        .maybeSingle();
      if (linhaErr) {
        throw new Error(`waha_history_media_read: ${linhaErr.message}`);
      }

      const linha = linhaRaw as LinhaDeMidiaHistorica | null;
      if (!linha) {
        resumo.mensagens_sem_linha += 1;
        continue;
      }
      if (linha.media_storage_path) {
        resumo.midias_ja_persistidas += 1;
        continue;
      }

      let mediaUrl = linha.media_url;
      let mediaMime = linha.media_mime;

      if (!mediaUrl) {
        const hidratadaRaw = (
          await waha.listChatMessages(session.waha_session_name, chat.id, {
            limit: 1,
            offset: messageOffset + i,
            downloadMedia: true,
          })
        )[0];
        const hidratada = payloadHistoricoDoStore(hidratadaRaw);
        mediaUrl = hidratada ? mediaUrlOf(hidratada) : null;
        mediaMime = (hidratada ? mediaMimeOf(hidratada) : null) ?? mediaMime;
      }

      if (!mediaUrl) {
        resumo.midias_indisponiveis += 1;
        const metadata = {
          ...(linha.metadata ?? {}),
          history_media_status: "unavailable",
          history_media_checked_at: new Date().toISOString(),
        };
        const { error: indisponivelErr } = await admin
          .from("messages")
          .update({ metadata })
          .eq("organization_id", session.organization_id)
          .eq("id", linha.id);
        if (indisponivelErr) {
          throw new Error(
            `waha_history_media_unavailable_update: ${indisponivelErr.message}`,
          );
        }
        continue;
      }

      const metadata = {
        ...(linha.metadata ?? {}),
        history_media_status: "queued",
        history_media_queued_at: new Date().toISOString(),
      };
      const { error: updateErr } = await admin
        .from("messages")
        .update({
          media_url: mediaUrl,
          media_mime: mediaMime,
          metadata,
        })
        .eq("organization_id", session.organization_id)
        .eq("id", linha.id);
      if (updateErr) {
        throw new Error(`waha_history_media_update: ${updateErr.message}`);
      }

      const { error: emitErr } = await admin.rpc("emit_event" as never, {
        p_event_type: "media.persist_requested",
        p_entity_kind: "message",
        p_entity_id: linha.id,
        p_payload: { message_id: linha.id },
        p_metadata: { source: "waha_history_sync", history_import: true },
        p_organization_id: session.organization_id,
      } as never);
      if (emitErr) {
        throw new Error(`waha_history_media_emit: ${emitErr.message}`);
      }

      resumo.midias_enfileiradas += 1;
      if (resumo.midias_enfileiradas >= maxMedia) {
        resumo.next_chat_offset = chatOffset;
        resumo.next_message_offset = messageOffset + i + 1;
        return resumo;
      }
    }

    messageOffset += mensagens.length;
    if (mensagens.length < Math.min(scanPageSize, restante)) {
      chatOffset += 1;
      messageOffset = 0;
      resumo.chats_vistos += 1;
    }
  }

  resumo.next_chat_offset = chatOffset;
  resumo.next_message_offset = messageOffset;
  return resumo;
}


export interface ResumoDaMidiaHistoricaIndexadaWaha {
  linhas_vistas: number;
  midias_enfileiradas: number;
  midias_ja_persistidas: number;
  midias_indisponiveis: number;
  linhas_ignoradas: number;
  next_message_id: string | null;
  completed: boolean;
}

export interface OpcoesDaMidiaHistoricaIndexadaWaha {
  afterMessageId?: string | null;
  batchSize?: number;
  scanPageSize?: number;
  maxMessagesPerChat?: number;
}

interface LinhaDeMidiaIndexada {
  id: string;
  external_id: string | null;
  media_url: string | null;
  media_mime: string | null;
  media_storage_path: string | null;
  metadata: Record<string, unknown> | null;
  contact_id: string;
  type: string;
}

interface ContatoDaMidiaIndexada {
  source_metadata: Record<string, unknown> | null;
  wa_lid: string | null;
  phone_number: string | null;
}

type PayloadHistorico = NonNullable<ReturnType<typeof payloadHistoricoDoStore>>;

function remoteJidDoExternalId(externalId: string | null): string | null {
  if (!externalId) return null;
  const primeiro = externalId.indexOf("_");
  const ultimo = externalId.lastIndexOf("_");
  if (primeiro < 0 || ultimo <= primeiro) return null;
  const meio = externalId.slice(primeiro + 1, ultimo);
  return meio.includes("@") ? meio : null;
}

function candidatosDeChatHistorico(
  contato: ContatoDaMidiaIndexada | null,
  externalId: string | null,
): string[] {
  const candidatos = new Set<string>();
  const source = objeto(contato?.source_metadata);
  const chatId = texto(source.waha_chat_id);
  if (chatId) candidatos.add(chatId);

  const remote = remoteJidDoExternalId(externalId);
  if (remote) candidatos.add(remote);

  const lid = texto(contato?.wa_lid);
  if (lid) candidatos.add(`${lid}@lid`);

  const phone = texto(contato?.phone_number)?.replace(/\D/g, "") ?? "";
  if (phone) candidatos.add(`${phone}@s.whatsapp.net`);

  return [...candidatos];
}

/**
 * Hidratação v3: usa as mensagens já importadas como índice.
 *
 * A lista de chats do WAHA pode trocar/mesclar identidades @lid e
 * @s.whatsapp.net depois do pareamento. Por isso o cursor da mídia não depende
 * mais do offset da lista de chats: cada external_id histórico é procurado nos
 * identificadores técnicos persistidos do próprio contato.
 */
export async function hidratarMidiaHistoricaWahaPorBanco(
  admin: Admin,
  waha: WahaClient,
  session: { id: string; organization_id: string; waha_session_name: string },
  opts: OpcoesDaMidiaHistoricaIndexadaWaha = {},
): Promise<ResumoDaMidiaHistoricaIndexadaWaha> {
  const batchSize = Math.min(Math.max(opts.batchSize ?? 5, 1), 20);
  const scanPageSize = Math.min(Math.max(opts.scanPageSize ?? 250, 1), 500);
  const maxMessagesPerChat = Math.min(
    Math.max(opts.maxMessagesPerChat ?? 5_000, scanPageSize),
    10_000,
  );

  let query = admin
    .from("messages")
    .select(
      "id,external_id,media_url,media_mime,media_storage_path,metadata,contact_id,type",
    )
    .eq("organization_id", session.organization_id)
    .eq("channel_session_id", session.id)
    .in("type", [...TIPOS_COM_BINARIO])
    .order("id", { ascending: true })
    .limit(batchSize);

  if (opts.afterMessageId) query = query.gt("id", opts.afterMessageId);

  const { data: rawRows, error: rowsErr } = await query;
  if (rowsErr) throw new Error(`waha_history_media_index_read: ${rowsErr.message}`);

  const rows = (rawRows ?? []) as LinhaDeMidiaIndexada[];
  const resumo: ResumoDaMidiaHistoricaIndexadaWaha = {
    linhas_vistas: rows.length,
    midias_enfileiradas: 0,
    midias_ja_persistidas: 0,
    midias_indisponiveis: 0,
    linhas_ignoradas: 0,
    next_message_id: null,
    completed: rows.length < batchSize,
  };

  const indices = new Map<
    string,
    Promise<Map<string, { payload: PayloadHistorico; offset: number }>>
  >();

  const indexarChat = (
    chatId: string,
  ): Promise<Map<string, { payload: PayloadHistorico; offset: number }>> => {
    const existente = indices.get(chatId);
    if (existente) return existente;

    const promessa = (async () => {
      const mapa = new Map<string, { payload: PayloadHistorico; offset: number }>();
      for (let offset = 0; offset < maxMessagesPerChat; offset += scanPageSize) {
        const mensagens = await waha.listChatMessages(
          session.waha_session_name,
          chatId,
          { limit: scanPageSize, offset, downloadMedia: false },
        );
        for (let i = 0; i < mensagens.length; i += 1) {
          const payload = payloadHistoricoDoStore(mensagens[i]);
          if (payload?.id) mapa.set(payload.id, { payload, offset: offset + i });
        }
        if (mensagens.length < scanPageSize) break;
      }
      return mapa;
    })();

    indices.set(chatId, promessa);
    return promessa;
  };

  for (const linha of rows) {
    resumo.next_message_id = linha.id;
    const metadataAtual = objeto(linha.metadata);

    if (metadataAtual.history_import !== true) {
      resumo.linhas_ignoradas += 1;
      continue;
    }
    if (linha.media_storage_path) {
      resumo.midias_ja_persistidas += 1;
      continue;
    }
    if (!linha.external_id) {
      resumo.linhas_ignoradas += 1;
      continue;
    }

    const { data: contatoRaw, error: contatoErr } = await admin
      .from("contacts")
      .select("source_metadata,wa_lid,phone_number")
      .eq("organization_id", session.organization_id)
      .eq("id", linha.contact_id)
      .maybeSingle();
    if (contatoErr) {
      throw new Error(`waha_history_media_contact_read: ${contatoErr.message}`);
    }

    const contato = contatoRaw as ContatoDaMidiaIndexada | null;
    const candidatos = candidatosDeChatHistorico(contato, linha.external_id);

    let mediaUrl = linha.media_url;
    let mediaMime = linha.media_mime;
    let mensagemEncontrada = false;

    if (!mediaUrl) {
      for (const chatId of candidatos) {
        let indice: Map<string, { payload: PayloadHistorico; offset: number }>;
        try {
          indice = await indexarChat(chatId);
        } catch {
          continue;
        }

        const achada = indice.get(linha.external_id);
        if (!achada) continue;
        mensagemEncontrada = true;
        mediaUrl = mediaUrlOf(achada.payload);
        mediaMime = mediaMimeOf(achada.payload) ?? mediaMime;

        if (!mediaUrl) {
          const hidratadaRaw = (
            await waha.listChatMessages(
              session.waha_session_name,
              chatId,
              { limit: 1, offset: achada.offset, downloadMedia: true },
            )
          )[0];
          const hidratada = payloadHistoricoDoStore(hidratadaRaw);
          mediaUrl = hidratada ? mediaUrlOf(hidratada) : null;
          mediaMime = (hidratada ? mediaMimeOf(hidratada) : null) ?? mediaMime;
        }

        if (mediaUrl) break;
      }
    }

    if (!mediaUrl) {
      resumo.midias_indisponiveis += 1;
      const metadata = {
        ...metadataAtual,
        history_media_status: "unavailable",
        history_media_strategy: "db-index-v1",
        history_media_reason: mensagemEncontrada
          ? "binary_unavailable"
          : "message_not_found",
        history_media_checked_at: new Date().toISOString(),
      };
      const { error: indisponivelErr } = await admin
        .from("messages")
        .update({ metadata })
        .eq("organization_id", session.organization_id)
        .eq("id", linha.id);
      if (indisponivelErr) {
        throw new Error(`waha_history_media_index_unavailable: ${indisponivelErr.message}`);
      }
      continue;
    }

    const metadata = {
      ...metadataAtual,
      history_media_status: "queued",
      history_media_strategy: "db-index-v1",
      history_media_queued_at: new Date().toISOString(),
    };
    const { error: updateErr } = await admin
      .from("messages")
      .update({ media_url: mediaUrl, media_mime: mediaMime, metadata })
      .eq("organization_id", session.organization_id)
      .eq("id", linha.id);
    if (updateErr) {
      throw new Error(`waha_history_media_index_update: ${updateErr.message}`);
    }

    const { error: emitErr } = await admin.rpc("emit_event" as never, {
      p_event_type: "media.persist_requested",
      p_entity_kind: "message",
      p_entity_id: linha.id,
      p_payload: { message_id: linha.id },
      p_metadata: {
        source: "waha_history_sync",
        history_import: true,
        strategy: "db-index-v1",
      },
      p_organization_id: session.organization_id,
    } as never);
    if (emitErr) {
      throw new Error(`waha_history_media_index_emit: ${emitErr.message}`);
    }

    resumo.midias_enfileiradas += 1;
  }

  if (resumo.completed) resumo.next_message_id = null;
  return resumo;
}
