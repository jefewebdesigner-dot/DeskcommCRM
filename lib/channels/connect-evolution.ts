import { createHash } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { ChannelConnectionError } from "@/lib/channels/connect-waha";
import { CHANNEL_PROVIDER_EVOLUTION } from "@/lib/channels/capabilities";
import type { EvolutionClient } from "@/lib/channels/evolution/client";
import { EvolutionError } from "@/lib/channels/evolution/client";
import { CABECALHO_DO_SEGREDO } from "@/lib/channels/evolution/webhook";
import type { ConnectChannelInput } from "@/lib/channels/connect-waha";

const channelSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  evolution_instance_name: z.string(),
  webhook_path_token: z.string(),
  status: z.enum(["STARTING", "SCAN_QR_CODE", "WORKING", "STOPPED", "FAILED"]),
  display_name: z.string().nullable().optional(),
  phone_number: z.string().nullable().optional(),
  status_reason: z.string().nullable().optional(),
  archived_at: z.string().nullable().optional(),
});
const receiptSchema = z.object({
  replay: z.boolean(),
  channel: channelSchema.nullable(),
  receipt_id: z.string().uuid(),
  lease_token: z.string().uuid().optional(),
  webhook_secret: z.string().min(16).optional(),
});

type Transport = Pick<EvolutionClient, "createInstance" | "instanceInfo" | "setWebhook" | "connect">;

export interface ConnectEvolutionInput extends Pick<ConnectChannelInput, "organizationId" | "idempotencyKey" | "userId" | "requestId" | "displayName"> {
  /** Origem pública do CRM (a Evolution chama de volta em `<origem>/api/v1/webhooks/channel/<token>`). */
  publicBaseUrl: string;
}

/**
 * Cria (ou retoma) a conexão de um canal Evolution. Mesmo contrato do `connectWahaChannel`:
 * o cliente autenticado reserva (RPC, com papel/MFA/idempotência), o serviço confirma
 * por lease+org; HTTP não participa da transação. Falha deixa a linha em `FAILED` com a
 * identidade preservada — o retry reaproveita a instância remota, e NADA aqui exclui
 * instância automaticamente.
 *
 * O segredo do webhook é gerado e cifrado no banco; chega aqui em claro uma única vez
 * (só na reserva nova) para ser configurado como cabeçalho da instância, e nunca sai
 * desta função nem vai ao navegador.
 */
export async function connectEvolutionChannel(
  authDb: SupabaseClient,
  serviceDb: SupabaseClient,
  evolution: Transport,
  input: ConnectEvolutionInput,
): Promise<{ channel: z.infer<typeof channelSchema>; replay: boolean }> {
  if (!z.string().uuid().safeParse(input.idempotencyKey).success) {
    throw new ChannelConnectionError("idempotency_key_required", 422);
  }
  const hash = createHash("sha256")
    .update(JSON.stringify({ provider: CHANNEL_PROVIDER_EVOLUTION, display_name: input.displayName ?? null }))
    .digest("hex");
  const { data, error } = await authDb.rpc("fn_reserve_evolution_connection", {
    p_org: input.organizationId,
    p_key: input.idempotencyKey,
    p_hash: hash,
    p_display_name: input.displayName ?? null,
  });
  if (error) {
    const code = ["idempotency_conflict", "connection_in_progress", "connection_mfa_required", "connection_forbidden"].find((c) =>
      error.message.includes(c),
    );
    throw new ChannelConnectionError(code ?? "connection_reservation_failed", error.code === "42501" ? 403 : code ? 409 : 500);
  }
  const receipt = receiptSchema.parse(data);
  const channel = receipt.channel;
  if (!channel || channel.organization_id !== input.organizationId) {
    throw new ChannelConnectionError("connection_reservation_missing", 410);
  }
  if (receipt.replay) return { channel, replay: true };
  if (!receipt.lease_token || !receipt.webhook_secret) throw new ChannelConnectionError("connection_lease_lost", 409);
  const leaseToken = receipt.lease_token;
  const segredo = receipt.webhook_secret;

  let created = false;
  async function finish(status: string, reason?: string) {
    const result = await serviceDb.rpc("fn_finish_channel_connection", {
      p_org: input.organizationId,
      p_receipt: receipt.receipt_id,
      p_lease: leaseToken,
      p_status: status,
      p_reason: reason ?? null,
      p_created: created,
    });
    if (result.error) throw new ChannelConnectionError("connection_checkpoint_failed", 503);
    return result.data;
  }

  const nome = channel.evolution_instance_name;
  const webhook = {
    url: `${input.publicBaseUrl.replace(/\/+$/, "")}/api/v1/webhooks/channel/${channel.webhook_path_token}`,
    headers: { [CABECALHO_DO_SEGREDO]: segredo },
  };

  try {
    let existente: Awaited<ReturnType<Transport["instanceInfo"]>> | null = null;
    try {
      existente = await evolution.instanceInfo(nome);
    } catch (cause) {
      if (!(cause instanceof EvolutionError && cause.instanceMissing)) throw cause;
    }

    let status: "SCAN_QR_CODE" | "WORKING" | "STARTING";
    if (existente) {
      // Retry: a instância já existe do outro lado. Segredo é novo a cada reserva, então
      // o cabeçalho é reaplicado antes de qualquer outra coisa.
      await evolution.setWebhook(nome, webhook);
      if (existente.state === "open") {
        status = "WORKING";
      } else {
        const qr = await evolution.connect(nome);
        status = qr.png || qr.pairingCode ? "SCAN_QR_CODE" : "STARTING";
      }
    } else {
      const criada = await evolution.createInstance({ instanceName: nome, webhookUrl: webhook.url, webhookHeaders: webhook.headers });
      created = true;
      await finish("remote_created");
      if (criada.instanceName !== nome) throw new Error("connection_postcondition_failed");
      status = criada.qr.png || criada.qr.pairingCode ? "SCAN_QR_CODE" : "STARTING";
    }

    const persisted = channelSchema.parse(await finish(status));
    if (persisted.organization_id !== input.organizationId || persisted.id !== channel.id || persisted.status !== status) {
      throw new Error("connection_checkpoint_mismatch");
    }
    void audit({
      action: channel.archived_at ? "channel.reactivated" : "channel.connected",
      actorUserId: input.userId,
      organizationId: input.organizationId,
      resourceType: "channel_session",
      resourceId: channel.id,
      requestId: input.requestId,
      metadata: { provider: CHANNEL_PROVIDER_EVOLUTION, origin: "connections" },
    });
    return { channel: persisted, replay: false };
  } catch (cause) {
    const code = "connection_repair_required";
    await finish("FAILED", code);
    throw new ChannelConnectionError(
      code,
      502,
      cause instanceof EvolutionError ? { operation: cause.operation, http_status: cause.httpStatus } : undefined,
    );
  }
}

/**
 * Reconexão de uma instância que já existe. Suave (padrão): se o aparelho segue
 * pareado a Baileys retoma sozinha; se não, pede QR novo. `force` descarta a credencial
 * (logout) e recomeça o pareamento — mesma semântica do WAHA, e pelo mesmo motivo só
 * a UI oferece depois do modo suave falhar. Instância inexistente do outro lado NÃO
 * é recriada aqui: recriar com o mesmo nome é decisão de Conectar (idempotente).
 */
export async function reconnectEvolutionChannel(
  evolution: Pick<EvolutionClient, "instanceInfo" | "connect" | "logout">,
  instanceName: string,
  force: boolean,
): Promise<"STARTING" | "SCAN_QR_CODE" | "WORKING"> {
  const info = await evolution.instanceInfo(instanceName);
  if (!force && info.state === "open") return "WORKING";
  if (force) await evolution.logout(instanceName).catch((cause) => {
    // Já deslogada (ou nunca pareada) não impede recomeçar.
    if (!(cause instanceof EvolutionError) || cause.httpStatus >= 500 || cause.httpStatus === 0) throw cause;
  });
  const qr = await evolution.connect(instanceName);
  return qr.png || qr.pairingCode ? "SCAN_QR_CODE" : "STARTING";
}
