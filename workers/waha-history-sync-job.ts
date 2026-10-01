import { createHash } from "node:crypto";
import type pg from "pg";

import type { Logger } from "@/lib/agent-engine/obs/logger";
import { enqueueJob, type JobRow } from "@/lib/agent-engine/queue/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWahaClient } from "@/lib/waha/client";
import {
  hidratarMidiaHistoricaWaha,
  hidratarMidiaHistoricaWahaPorBanco,
  sincronizarHistoricoWaha,
} from "@/lib/waha/history-sync";

const CHATS_POR_JOB = 20;
const MIDIAS_POR_JOB = 5;
const MENSAGENS_VARREDURA_POR_JOB = 500;

function inteiroNaoNegativo(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0;
}

function uuidDeterministico(channelId: string, cursor: string): string {
  const bytes = createHash("sha256")
    .update(`waha-history:${channelId}:${cursor}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function objeto(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

async function atualizarMetadata(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  channelId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin
    .from("channel_sessions")
    .update({ metadata })
    .eq("id", channelId)
    .eq("organization_id", organizationId);
  if (error) throw new Error(`waha_history_metadata: ${error.message}`);
}

/**
 * Backfill histórico do WhatsApp em duas fases:
 *
 * 1. texto/estrutura: importa conversas e mensagens sem baixar anos de anexos;
 * 2. mídia: revisita o store com cursor fino e hidrata poucos binários por job.
 *
 * Ambas são idempotentes. O mesmo kind é usado nas duas fases para não ampliar
 * o vocabulário da fila nem exigir uma migration só para a segunda passagem.
 */
export async function executarSincronizacaoHistoricaWaha(
  job: JobRow,
  pool: pg.Pool,
  log: Logger,
): Promise<void> {
  if (job.kind !== "waha_history_sync") {
    throw new Error("waha_history_job_kind_invalido");
  }

  const channelId =
    typeof job.payload.channel_session_id === "string"
      ? job.payload.channel_session_id
      : "";
  if (!channelId) throw new Error("waha_history_channel_id_ausente");

  const admin = createAdminClient();
  const { data: channel, error } = await admin
    .from("channel_sessions")
    .select("id,organization_id,waha_session_name,status,archived_at,metadata")
    .eq("id", channelId)
    .eq("organization_id", job.organization_id)
    .maybeSingle();

  if (error) throw new Error(`waha_history_channel_read: ${error.message}`);
  if (!channel || channel.archived_at) return;
  if (channel.status !== "WORKING") {
    throw new Error("waha_history_channel_not_working");
  }

  const waha = getWahaClient();
  if (!waha) throw new Error("waha_history_transport_not_configured");

  const phase =
    job.payload.phase === "media_db"
      ? "media_db"
      : job.payload.phase === "media"
        ? "media"
        : "messages";
  const atual = objeto(channel.metadata);

  if (phase === "media_db") {
    const afterMessageId =
      typeof job.payload.after_message_id === "string"
        ? job.payload.after_message_id
        : null;

    const resumo = await hidratarMidiaHistoricaWahaPorBanco(
      admin,
      waha,
      {
        id: channel.id,
        organization_id: channel.organization_id,
        waha_session_name: channel.waha_session_name,
      },
      {
        afterMessageId,
        batchSize: MIDIAS_POR_JOB,
        scanPageSize: 250,
        maxMessagesPerChat: 5_000,
      },
    );

    if (!resumo.completed && resumo.next_message_id) {
      await enqueueJob(pool, job.organization_id, {
        kind: "waha_history_sync",
        sourceEventId: uuidDeterministico(
          channelId,
          `media-db:${resumo.next_message_id}`,
        ),
        payload: {
          phase: "media_db",
          channel_session_id: channelId,
          after_message_id: resumo.next_message_id,
        },
        priority: 190,
        runAfter: new Date(Date.now() + 1_000),
        maxAttempts: 8,
      });
    }

    const historicoMidia = objeto(atual.whatsapp_history_media_sync);
    const metadata = {
      ...atual,
      whatsapp_history_media_sync: {
        ...historicoMidia,
        strategy: "db-index-v1",
        state: resumo.completed ? "completed" : "running",
        last_batch_at: new Date().toISOString(),
        next_message_id: resumo.completed ? null : resumo.next_message_id,
        ...(resumo.completed
          ? { completed_at: new Date().toISOString() }
          : {}),
      },
    };
    await atualizarMetadata(
      admin,
      job.organization_id,
      channelId,
      metadata,
    );

    log.info("waha history media db-index: lote concluído", {
      job_id: job.id,
      channel_session_id: channelId,
      after_message_id: afterMessageId,
      linhas_vistas: resumo.linhas_vistas,
      midias_enfileiradas: resumo.midias_enfileiradas,
      midias_ja_persistidas: resumo.midias_ja_persistidas,
      midias_indisponiveis: resumo.midias_indisponiveis,
      linhas_ignoradas: resumo.linhas_ignoradas,
      final: resumo.completed,
    });
    return;
  }

  if (phase === "media") {
    const chatOffset = inteiroNaoNegativo(job.payload.chat_offset);
    const messageOffset = inteiroNaoNegativo(job.payload.message_offset);

    const resumo = await hidratarMidiaHistoricaWaha(
      admin,
      waha,
      {
        id: channel.id,
        organization_id: channel.organization_id,
        waha_session_name: channel.waha_session_name,
      },
      {
        startChatOffset: chatOffset,
        startMessageOffset: messageOffset,
        maxMedia: MIDIAS_POR_JOB,
        maxMessagesScanned: MENSAGENS_VARREDURA_POR_JOB,
        scanPageSize: 100,
      },
    );

    if (
      !resumo.completed &&
      resumo.next_chat_offset !== null &&
      resumo.next_message_offset !== null
    ) {
      await enqueueJob(pool, job.organization_id, {
        kind: "waha_history_sync",
        sourceEventId: uuidDeterministico(
          channelId,
          `media-v2:${resumo.next_chat_offset}:${resumo.next_message_offset}`,
        ),
        payload: {
          phase: "media",
          channel_session_id: channelId,
          chat_offset: resumo.next_chat_offset,
          message_offset: resumo.next_message_offset,
        },
        priority: 190,
        runAfter: new Date(Date.now() + 1_000),
        maxAttempts: 8,
      });
    }

    const historicoMidia = objeto(atual.whatsapp_history_media_sync);
    const metadata = {
      ...atual,
      whatsapp_history_media_sync: {
        ...historicoMidia,
        state: resumo.completed ? "completed" : "running",
        last_batch_at: new Date().toISOString(),
        next_chat_offset: resumo.completed ? null : resumo.next_chat_offset,
        next_message_offset: resumo.completed
          ? null
          : resumo.next_message_offset,
        ...(resumo.completed
          ? { completed_at: new Date().toISOString() }
          : {}),
      },
    };
    await atualizarMetadata(
      admin,
      job.organization_id,
      channelId,
      metadata,
    );

    log.info("waha history media: lote concluído", {
      job_id: job.id,
      channel_session_id: channelId,
      chat_offset: chatOffset,
      message_offset: messageOffset,
      chats_vistos: resumo.chats_vistos,
      mensagens_vistas: resumo.mensagens_vistas,
      midias_encontradas: resumo.midias_encontradas,
      midias_enfileiradas: resumo.midias_enfileiradas,
      midias_ja_persistidas: resumo.midias_ja_persistidas,
      midias_indisponiveis: resumo.midias_indisponiveis,
      mensagens_sem_linha: resumo.mensagens_sem_linha,
      final: resumo.completed,
    });
    return;
  }

  const offset = inteiroNaoNegativo(job.payload.chat_offset);
  const resumo = await sincronizarHistoricoWaha(
    admin,
    waha,
    {
      id: channel.id,
      organization_id: channel.organization_id,
      waha_session_name: channel.waha_session_name,
    },
    {
      startChatOffset: offset,
      maxChats: CHATS_POR_JOB,
      chatPageSize: CHATS_POR_JOB,
      messagePageSize: 200,
    },
  );

  // No primeiro lote, 0 chats normalmente significa que o WhatsApp ainda está
  // entregando os blocos de history sync. Lançar deixa a fila aplicar backoff.
  if (offset === 0 && resumo.chats_vistos === 0) {
    throw new Error("waha_history_store_ainda_vazio");
  }

  const proximoOffset = offset + resumo.chats_vistos;
  const final = resumo.chats_vistos < CHATS_POR_JOB;

  if (!final) {
    await enqueueJob(pool, job.organization_id, {
      kind: "waha_history_sync",
      sourceEventId: uuidDeterministico(channelId, `messages:${proximoOffset}`),
      payload: {
        channel_session_id: channelId,
        chat_offset: proximoOffset,
      },
      priority: 180,
      runAfter: new Date(Date.now() + 1_000),
      maxAttempts: 8,
    });
  } else {
    // Só começa a hidratar mídia depois que a estrutura textual inteira está no
    // Inbox. Assim um anexo grande nunca impede conversas posteriores de aparecer.
    await enqueueJob(pool, job.organization_id, {
      kind: "waha_history_sync",
      sourceEventId: uuidDeterministico(channelId, "media-db:start"),
      payload: {
        phase: "media_db",
        channel_session_id: channelId,
        after_message_id: null,
      },
      priority: 190,
      runAfter: new Date(Date.now() + 2_000),
      maxAttempts: 8,
    });
  }

  const historico = objeto(atual.whatsapp_history_sync);
  const metadata = {
    ...atual,
    whatsapp_history_sync: {
      ...historico,
      state: final ? "completed" : "running",
      last_batch_at: new Date().toISOString(),
      last_offset: offset,
      next_offset: final ? null : proximoOffset,
      ...(final ? { completed_at: new Date().toISOString() } : {}),
    },
  };
  await atualizarMetadata(admin, job.organization_id, channelId, metadata);

  log.info("waha history sync: lote concluído", {
    job_id: job.id,
    channel_session_id: channelId,
    offset,
    chats_vistos: resumo.chats_vistos,
    chats_importados: resumo.chats_importados,
    mensagens_vistas: resumo.mensagens_vistas,
    mensagens_inseridas: resumo.mensagens_inseridas,
    mensagens_duplicadas: resumo.mensagens_duplicadas,
    final,
  });
}
