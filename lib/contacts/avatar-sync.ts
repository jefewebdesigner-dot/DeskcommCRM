/**
 * Sincronização persistente das fotos de perfil dos contatos.
 *
 * Reutilizada pela rota de cron e pelo worker nativo. A foto do provider é
 * temporária; salvamos o binário no bucket privado whatsapp-media e guardamos
 * apenas o caminho estável em contacts.avatar_storage_path.
 */
import { randomUUID } from "node:crypto";

import {
  DEFAULT_CHANNEL_PROVIDER,
  getAdapter,
  type ChannelProvider,
} from "@/lib/channels";
import {
  CHANNEL_SESSION_REF_COLUMNS,
  resolveSessionRef,
  type ChannelSessionRef,
} from "@/lib/channels/session-ref";
import { PROVIDERS_DE_MENSAGEM } from "@/lib/channels/capabilities";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const AVATAR_SCAN_LIMIT = 25;
export const AVATAR_REFRESH_AFTER_DAYS = 7;
const MAX_BYTES = 2 * 1024 * 1024;

interface ContactRow {
  id: string;
  organization_id: string;
  wa_identity: string | null;
  wa_lid: string | null;
  phone_number: string | null;
  avatar_storage_path: string | null;
}

export interface AvatarSyncResult {
  scanned: number;
  updated: number;
  no_picture: number;
  failed: number;
}

export async function sincronizarAvataresContatos(
  opts: { limit?: number; requestId?: string } = {},
): Promise<AvatarSyncResult> {
  const requestId = opts.requestId ?? randomUUID();
  const limit = Math.min(Math.max(opts.limit ?? AVATAR_SCAN_LIMIT, 1), 100);
  const admin = createAdminClient();
  const cutoff = new Date(
    Date.now() - AVATAR_REFRESH_AFTER_DAYS * 86_400_000,
  ).toISOString();

  const { data: contatos, error: queryError } = await admin
    .from("contacts")
    .select(
      "id, organization_id, wa_identity, wa_lid, phone_number, avatar_storage_path",
    )
    .or("wa_identity.not.is.null,wa_lid.not.is.null,phone_number.not.is.null")
    .eq("is_anonymized", false)
    .or(`avatar_updated_at.is.null,avatar_updated_at.lt.${cutoff}`)
    .order("avatar_updated_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (queryError) {
    throw new Error(`contact_avatar_query: ${queryError.message}`);
  }

  const rows = (contatos ?? []) as ContactRow[];
  let updated = 0;
  let noPicture = 0;
  let failed = 0;

  for (const c of rows) {
    // Revalida is_anonymized no UPDATE: o contato pode ser anonimizado enquanto
    // estamos em I/O de rede.
    const carimbar = async (path: string | null): Promise<boolean> => {
      const { data: afetadas, error } = await admin
        .from("contacts")
        .update({
          ...(path !== null ? { avatar_storage_path: path } : {}),
          avatar_updated_at: new Date().toISOString(),
        })
        .eq("id", c.id)
        .eq("organization_id", c.organization_id)
        .eq("is_anonymized", false)
        .select("id");
      if (error) throw new Error(`contact_avatar_update: ${error.message}`);
      return (afetadas ?? []).length > 0;
    };

    try {
      const { data: sessao, error: sessaoErr } = await admin
        .from("channel_sessions")
        .select(`provider, ${CHANNEL_SESSION_REF_COLUMNS}`)
        .eq("organization_id", c.organization_id)
        .eq("status", "WORKING")
        .in("provider", [...PROVIDERS_DE_MENSAGEM])
        .limit(1)
        .maybeSingle();

      if (sessaoErr) throw new Error(sessaoErr.message);

      const ref = sessao
        ? resolveSessionRef(sessao as unknown as ChannelSessionRef)
        : null;
      if (!ref) {
        await carimbar(null);
        noPicture += 1;
        continue;
      }

      const adapter = getAdapter(
        (
          sessao as { provider?: ChannelProvider | null } | null
        )?.provider ?? DEFAULT_CHANNEL_PROVIDER,
      );
      if (!adapter.fetchProfilePictureUrl) {
        await carimbar(null);
        noPicture += 1;
        continue;
      }

      const recipient = adapter.resolveRecipient({
        isGroup: false,
        groupChatId: null,
        phoneNumber: c.phone_number,
        waIdentity: c.wa_identity,
        waLid: c.wa_lid,
      });
      if (!recipient) {
        await carimbar(null);
        noPicture += 1;
        continue;
      }

      const profilePictureURL = await adapter.fetchProfilePictureUrl({
        organizationId: c.organization_id,
        sessionRef: ref,
        recipient,
      });
      if (!profilePictureURL) {
        await carimbar(null);
        noPicture += 1;
        continue;
      }

      const img = await fetch(profilePictureURL, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!img.ok) {
        await carimbar(null);
        failed += 1;
        continue;
      }

      const buf = Buffer.from(await img.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) {
        await carimbar(null);
        failed += 1;
        continue;
      }

      const contentType =
        img.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
      const path = `${c.organization_id}/avatars/${c.id}.jpg`;
      const { error: upErr } = await admin.storage
        .from("whatsapp-media")
        .upload(path, buf, { contentType, upsert: true });
      if (upErr) {
        await carimbar(null);
        failed += 1;
        continue;
      }

      const gravou = await carimbar(path);
      if (!gravou) {
        // O contato virou anônimo entre download e gravação. O objeto já existe,
        // então precisa entrar na mesma fila de redação da cascata LGPD.
        await admin.from("storage_redaction_queue").upsert(
          {
            organization_id: c.organization_id,
            bucket: "whatsapp-media",
            object_path: path,
            status: "pending",
            attempts: 0,
            processed_at: null,
            error_message: null,
          },
          { onConflict: "bucket,object_path" },
        );
        logger.warn(
          "[contact-avatars] anonimizado durante a busca; foto devolvida à fila",
          {
            contact_id: c.id,
            organization_id: c.organization_id,
            requestId,
          },
        );
        noPicture += 1;
        continue;
      }

      updated += 1;
    } catch (err) {
      try {
        await carimbar(null);
      } catch {
        // A falha principal já será registrada abaixo.
      }
      failed += 1;
      logger.warn("[contact-avatars] contato falhou", {
        contact_id: c.id,
        detail: err instanceof Error ? err.message : String(err),
        requestId,
      });
    }
  }

  return {
    scanned: rows.length,
    updated,
    no_picture: noPicture,
    failed,
  };
}
