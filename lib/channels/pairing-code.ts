import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_CHANNEL_PROVIDER } from "./capabilities";
import { getAdapter } from "./index";
import { CHANNEL_SESSION_REF_COLUMNS, resolveSessionRef, type ChannelSessionRef } from "./session-ref";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "./archived";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";

export const pairingPhoneSchema = z
  .string()
  .trim()
  .max(32)
  .regex(/^\+?[\d\s()-]+$/)
  .transform((value) => value.replace(/\D/g, ""))
  .pipe(z.string().regex(/^[1-9]\d{7,14}$/));

export class PairingCodeError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Reuses the existing session. Never creates, logs out or restarts a number. */
export async function requestChannelPairingCode(
  db: SupabaseClient,
  organizationId: string,
  channelId: string,
  phoneNumber: string,
): Promise<{ code: string }> {
  const buscar = (columns: string) =>
    db
      .from("channel_sessions")
      .select(columns)
      .eq("organization_id", organizationId)
      .eq("id", channelId)
      .maybeSingle();
  const { data, error } = await queryTolerantToMissingArchived(
    () => buscar(`${CHANNEL_SESSION_REF_COLUMNS}, ${ARCHIVED_AT}`),
    () => buscar(CHANNEL_SESSION_REF_COLUMNS),
  );
  if (error)
    throw new PairingCodeError(
      "pairing_lookup_failed",
      "Não foi possível consultar esta conexão. Tente novamente.",
      503,
    );
  const session = data as (Record<string, string | null> & { archived_at?: string | null }) | null;
  if (!session) throw new PairingCodeError("not_found", "Canal não encontrado.", 404);
  if (session.archived_at)
    throw new PairingCodeError(
      "channel_archived",
      "Este canal foi excluído. Conecte um número para voltar a atender.",
      409,
    );
  const provider = (session.provider ?? DEFAULT_CHANNEL_PROVIDER) as ChannelSessionRef["provider"];
  const adapter = getAdapter(provider);
  const ref = session.waha_session_name ?? session.evolution_instance_name;
  // Canal oficial não pareia por código: sem sessão no transporte, ou o adapter não sabe.
  if (!ref || !adapter.requestPairingCode)
    throw new PairingCodeError(
      "pairing_not_supported",
      "Este canal não conecta por código de pareamento.",
      422,
    );
  const sessionRef = resolveSessionRef({ ...session, provider } as unknown as ChannelSessionRef);

  // Per-channel bucket prevents two operators from continuously invalidating codes.
  const limit = await checkRateLimit(`pairing-code:${organizationId}:${channelId}`, 1, 30);
  if (!limit.allowed)
    throw new PairingCodeError(
      "rate_limited",
      "Aguarde 30 segundos antes de pedir outro código.",
      429,
    );
  const result = await adapter
    .requestPairingCode({ organizationId, sessionRef, phone: phoneNumber })
    // Neither upstream bodies nor exceptions may expose a phone, code or credential.
    .catch(() => null);
  if (!result)
    throw new PairingCodeError(
      "pairing_unavailable",
      "O serviço de conexão não respondeu. Tente novamente ou use o QR Code.",
      502,
    );
  switch (result.kind) {
    case "code":
      return { code: result.code };
    case "already_connected":
      throw new PairingCodeError("channel_already_connected", "Este WhatsApp já está conectado.", 409);
    case "not_ready":
      throw new PairingCodeError(
        "pairing_not_ready",
        "A conexão ainda não está pronta. Aguarde ou use Reconectar e tente novamente.",
        409,
      );
    case "unavailable":
      throw new PairingCodeError(
        "pairing_unavailable",
        "O serviço de conexão não respondeu. Tente novamente ou use o QR Code.",
        502,
      );
    default:
      throw new PairingCodeError(
        "pairing_code_failed",
        "Não foi possível gerar o código. Confira o número e tente novamente, ou use o QR Code.",
        502,
      );
  }
}
