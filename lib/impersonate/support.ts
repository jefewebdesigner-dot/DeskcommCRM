import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail } from "@/lib/api/wrappers";

export const supportSchema = z.object({
  id: z.string().uuid(), organization_id: z.string().uuid(), actor_user_id: z.string().uuid(),
  auth_session_id: z.string().uuid(), previous_organization_id: z.string().uuid().nullable(),
  expires_at: z.string(), name: z.string(), locale: z.string().nullable(),
  access_mode: z.enum(["full", "support_readonly"]), status: z.enum(["active", "expired", "revoked"]),
});
export type SupportContext = z.infer<typeof supportSchema>;

/** Chamar depois de getUser. A RPC resolve auth.uid + auth.session_id, nunca cookie. */
export async function readSupportContext(db: Awaited<ReturnType<typeof createClient>>): Promise<SupportContext | null> {
  const { data, error } = await db.rpc("fn_support_context");
  if (error) throw new Error("Não foi possível confirmar o acompanhamento administrativo.");
  return data === null ? null : supportSchema.parse(data);
}

export function supportWriteError(support: SupportContext | null | undefined, organizationId?: string): string | null {
  if (!support || (organizationId && organizationId !== support.organization_id)) return null;
  if (support.status !== "active") return "O acompanhamento terminou. Saia do acompanhamento para continuar.";
  if (support.access_mode !== "full") return "Este acompanhamento permite somente leitura.";
  return null;
}

/** Guarda de EFEITO, antes dos clientes service role. Não substitui RBAC/MFA.
 * Sem cookie de usuário, workers/tokens seguem sua autorização própria.
 * targetOrganizationId é exclusivamente path ou registro confiável de administração.
 */
export async function requireSupportWrite(targetOrganizationId?: string) {
  try {
    const { loadAuthUser } = await import("@/lib/auth/server");
    const user = await loadAuthUser();
    if (!user) return null;
    const support = user.support;
    const message = supportWriteError(support, targetOrganizationId);
    return message ? fail("forbidden", message, 403) : null;
  } catch {
    return fail("upstream_unavailable", "Não foi possível confirmar a permissão de acompanhamento.", 503);
  }
}

/** Identidade vem do state HMAC já verificado, nunca do body. */
export async function supportCallbackWriteAllowed(
  organizationId: string,
  actorId?: string,
  sessionId?: string,
): Promise<boolean> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { data, error } = await createAdminClient().rpc("fn_support_callback_write_allowed", {
    p_org: organizationId,
    p_actor: actorId ?? null,
    p_session: sessionId ?? null,
  });
  if (!error) return data === true;

  // Neon Data API usa uma identidade técnica com role `authenticated`.
  // Esta RPC é fechada para usuários autenticados comuns, então o admin client
  // pode receber 42501 mesmo sendo uma chamada server-side.
  // O fallback usa a DATABASE_URL privada da aplicação (gravity_app_*), cuja ACL
  // é concedida pela migration Neon 0021.
  try {
    const [{ Pool }, { env }] = await Promise.all([import("pg"), import("@/lib/env")]);
    const pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 5_000,
      statement_timeout: 10_000,
    });
    try {
      const resultado = await pool.query<{ permitido: boolean }>(
        "select public.fn_support_callback_write_allowed($1::uuid, $2::uuid, $3::uuid) as permitido",
        [organizationId, actorId ?? null, sessionId ?? null],
      );
      return resultado.rows[0]?.permitido === true;
    } finally {
      await pool.end().catch(() => undefined);
    }
  } catch {
    return false;
  }
}
export async function authenticatedSessionId(): Promise<string> {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error("Sessão ausente.");
  const { data } = await db.auth.getClaims();
  return z.string().uuid().parse(data?.claims.session_id);
}
