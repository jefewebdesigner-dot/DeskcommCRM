import { z } from "zod";

import { CHANNEL_PROVIDER_EVOLUTION, CHANNEL_PROVIDER_WAHA } from "@/lib/channels/capabilities";

/**
 * Body para conectar um novo canal WhatsApp. `display_name` é opcional —
 * um rótulo amigável ("Vendas", "Suporte") que o WAHA sobrescreve com o
 * nome do perfil quando a sessão fica WORKING.
 */
export const createChannelSchema = z.object({
  display_name: z.string().trim().min(1).max(80).optional(),
  /** Transporte do número novo. Omitido = o padrão (WAHA), que preserva quem já usa. */
  provider: z
    .string()
    .refine((p) => p === CHANNEL_PROVIDER_WAHA || p === CHANNEL_PROVIDER_EVOLUTION, "provider_invalido")
    .optional(),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;

/** Status canônicos de sessão (WAHA + DB CHECK constraint). */
export const CHANNEL_STATUSES = [
  "STARTING",
  "SCAN_QR_CODE",
  "WORKING",
  "STOPPED",
  "FAILED",
] as const;

export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

export function isChannelStatus(v: string): v is ChannelStatus {
  return (CHANNEL_STATUSES as readonly string[]).includes(v);
}
