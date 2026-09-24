/**
 * Cliente técnico server-only.
 *
 * Compatibilidade de superfície com o antigo Supabase service_role, mas sem
 * service_role, sem chave pública privilegiada e sem conexão de migrations.
 *
 * - dados/RPC: Neon Data API + JWT da identidade técnica
 * - usuários: Neon Auth admin API + sessão técnica
 * - arquivos: Neon Object Storage (S3-compatible)
 */
import "server-only";

import { createClient as createNeonClient } from "@neondatabase/neon-js";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { neonStorage } from "@/lib/neon/storage";
import {
  serviceAuthRequest,
  serviceJwt,
} from "@/lib/neon/service-session";

type CompatError = { message: string; status?: number } | null;

function erro(message: string, status?: number): CompatError {
  return { message, ...(status !== undefined ? { status } : {}) };
}

async function jsonOuNull(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function usuarioAdminCompat(raw: unknown): User | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  const id = typeof u.id === "string" ? u.id : "";
  if (!id) return null;
  const name = typeof u.name === "string" ? u.name : "";
  const image = typeof u.image === "string" ? u.image : null;
  const createdAt =
    u.createdAt instanceof Date
      ? u.createdAt.toISOString()
      : typeof u.createdAt === "string"
        ? u.createdAt
        : new Date().toISOString();
  const updatedAt =
    u.updatedAt instanceof Date
      ? u.updatedAt.toISOString()
      : typeof u.updatedAt === "string"
        ? u.updatedAt
        : createdAt;

  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: typeof u.email === "string" ? u.email : undefined,
    phone: "",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {
      name,
      full_name: name,
      avatar_url: image,
    },
    identities: [],
    created_at: createdAt,
    updated_at: updatedAt,
    last_sign_in_at: undefined,
    is_anonymous: false,
  } as User;
}

async function listUsers(options?: { page?: number; perPage?: number }) {
  try {
    const limit = Math.max(1, Math.min(1000, options?.perPage ?? 50));
    const page = Math.max(1, options?.page ?? 1);
    const offset = (page - 1) * limit;
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    const response = await serviceAuthRequest(
      `admin/list-users?${params.toString()}`,
      { method: "GET" },
    );
    const body = (await jsonOuNull(response)) as
      | { users?: unknown[]; total?: number }
      | null;
    if (!response.ok) {
      return {
        data: { users: [] },
        error: erro(
          (body as { message?: string } | null)?.message ??
            `HTTP ${response.status}`,
          response.status,
        ),
      };
    }
    return {
      data: {
        users: Array.isArray(body?.users)
          ? body.users
              .map(usuarioAdminCompat)
              .filter((user): user is User => user !== null)
          : [],
        total: body?.total ?? 0,
      },
      error: null,
    };
  } catch (error) {
    return {
      data: { users: [] },
      error: erro(error instanceof Error ? error.message : String(error)),
    };
  }
}

async function getUserById(userId: string) {
  try {
    const params = new URLSearchParams({
      limit: "1",
      offset: "0",
      filterField: "id",
      filterValue: userId,
    });
    const response = await serviceAuthRequest(
      `admin/list-users?${params.toString()}`,
      { method: "GET" },
    );
    const body = (await jsonOuNull(response)) as
      | { users?: unknown[] }
      | null;
    if (!response.ok) {
      return {
        data: { user: null },
        error: erro(
          (body as { message?: string } | null)?.message ??
            `HTTP ${response.status}`,
          response.status,
        ),
      };
    }
    const user = usuarioAdminCompat(
      Array.isArray(body?.users) ? body.users[0] ?? null : null,
    );
    return {
      data: { user },
      error: user ? null : erro("Usuário não encontrado.", 404),
    };
  } catch (error) {
    return {
      data: { user: null },
      error: erro(error instanceof Error ? error.message : String(error)),
    };
  }
}

const authAdminCompat = {
  listUsers,
  getUserById,
  mfa: {
    async listFactors(_input: { userId: string }) {
      // MFA Supabase não é transportado automaticamente. Enquanto o plugin
      // 2FA Neon não estiver habilitado, não inventamos fatores.
      return { data: { factors: [] }, error: null };
    },
    async deleteFactor(_input: { userId: string; id: string }) {
      return { data: {}, error: null };
    },
  },
};

let client: ReturnType<typeof createNeonClient> | null = null;

export function createAdminClient(): SupabaseClient {
  client ??= createNeonClient({
    dataApi: {
      url: env.NEON_DATA_API_URL,
      getToken: serviceJwt,
    },
  });

  return Object.assign(client, {
    storage: neonStorage(),
    auth: { admin: authAdminCompat },
    // Broadcast Supabase saiu da arquitetura. Consumidores novos devem persistir
    // o evento no banco; a UI reconcilia por polling protegido por RLS.
    channel(name: string) {
      return {
        name,
        async send(_payload: unknown) {
          return { status: "ok" as const };
        },
      };
    },
    async removeChannel(_channel: unknown) {
      return "ok" as const;
    },
  }) as unknown as SupabaseClient;
}
