/**
 * Config da borda CRM pós-fusão.
 *
 * O nome "supabase" permanece no shape interno para evitar uma reescrita ampla
 * do engine, mas o objeto agora é o cliente técnico Neon central:
 * Data API + Neon Auth + Object Storage S3.
 */
import { createAdminClient } from "@/lib/supabase/admin";

export interface CrmEdgeConfig {
  /** Cliente técnico server-only do backend Neon. */
  supabase: ReturnType<typeof createAdminClient>;
  /** ai_agents.id do agente publicado deste turno. */
  agentActorId?: string;
}

/** Falha transitória da borda CRM/WAHA. */
export class CrmTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrmTransportError";
  }
}

/**
 * O parâmetro legado é aceito e ignorado para manter testes/worker compatíveis
 * durante a transição. Credenciais nunca vêm mais daqui.
 */
export function crmEdgeConfigFromEnv(
  _legacy?: {
    SUPABASE_URL?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
  },
): CrmEdgeConfig {
  return { supabase: createAdminClient() };
}
