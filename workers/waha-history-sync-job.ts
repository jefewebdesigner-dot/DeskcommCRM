import { createHash } from "node:crypto";
import type pg from "pg";

import type { Logger } from "@/lib/agent-engine/obs/logger";
import { enqueueJob, type JobRow } from "@/lib/agent-engine/queue/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWahaClient } from "@/lib/waha/client";
import { sincronizarHistoricoWaha } from "@/lib/waha/history-sync";

const CHATS_POR_JOB = 20;

function inteiroNaoNegativo(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0;
}

function uuidDeterministico(channelId: string, offset: number): string {
  const bytes = createHash("sha256")
    .update(`waha-history:${channelId}:${offset}`)
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

/**
 * Backfill histórico do WhatsApp em lotes.
 *
 * O job não tem contact_id: ele é da sessão inteira. A persistência é
 * idempotente por external_id, então retry/reaper não duplica mensagens.
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

  const offset = inteiroNaoNegativo(job.payload.chat_offset);
  const admin = createAdminClient();
  const { data: channel, error } = await admin
    .from("channel_sessions")
    .select("id,organization_id,waha_session_name,status,archived_at,metadata")
    .eq("id", channelId)
    .eq("organization_id", job.organization_id)
    .maybeSingle();

  if (error) throw new Error(`waha_history_channel_read: ${error.message}`);
  if (!channel || channel.archived_at) return;
  if (channel.status !== "WORKING") throw new Error("waha_history_channel_not_working");

  const waha = getWahaClient();
  if (!waha) throw new Error("waha_history_transport_not_configured");

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
  if (resumo.chats_vistos >= CHATS_POR_JOB) {
    await enqueueJob(pool, job.organization_id, {
      kind: "waha_history_sync",
      sourceEventId: uuidDeterministico(channelId, proximoOffset),
      payload: {
        channel_session_id: channelId,
        chat_offset: proximoOffset,
      },
      priority: 180,
      runAfter: new Date(Date.now() + 1_000),
      maxAttempts: 8,
    });
  }

  const atual = objeto(channel.metadata);
  const historico = objeto(atual.whatsapp_history_sync);
  const final = resumo.chats_vistos < CHATS_POR_JOB;
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

  const { error: metadataErr } = await admin
    .from("channel_sessions")
    .update({ metadata })
    .eq("id", channelId)
    .eq("organization_id", job.organization_id);
  if (metadataErr) {
    throw new Error(`waha_history_metadata: ${metadataErr.message}`);
  }

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
