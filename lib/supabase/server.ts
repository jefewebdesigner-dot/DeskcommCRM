/**
 * Adaptador server-side do backend Neon.
 *
 * O nome da pasta fica por compatibilidade de imports. Em runtime:
 * - dados/RPC: Neon Data API
 * - autenticação: Neon Auth
 *
 * O tipo SupabaseClient é mantido temporariamente como CONTRATO estrutural do
 * restante do CRM; nenhuma conexão ou credencial Supabase é usada aqui.
 */
import { createClient as createNeonClient } from "@neondatabase/neon-js";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import { neonAuth } from "@/lib/neon/auth-server";

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value) return value;
  return new Date().toISOString();
}

function usuarioCompat(raw: unknown): User | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  const id = typeof u.id === "string" ? u.id : "";
  if (!id) return null;

  const email = typeof u.email === "string" ? u.email : undefined;
  const name = typeof u.name === "string" ? u.name : "";
  const image = typeof u.image === "string" ? u.image : null;
  const createdAt = iso(u.createdAt ?? u.created_at);
  const updatedAt = iso(u.updatedAt ?? u.updated_at ?? u.createdAt ?? u.created_at);
  const emailVerified =
    u.emailVerified === true ||
    typeof u.email_confirmed_at === "string" ||
    typeof u.confirmed_at === "string";

  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email,
    phone: "",
    app_metadata: {
      provider: "email",
      providers: ["email"],
    },
    user_metadata: {
      name,
      full_name: name,
      avatar_url: image,
    },
    identities: [],
    created_at: createdAt,
    updated_at: updatedAt,
    email_confirmed_at: emailVerified ? createdAt : undefined,
    confirmed_at: emailVerified ? createdAt : undefined,
    last_sign_in_at: undefined,
    is_anonymous: false,
  } as User;
}

function decodeJwt(token: string): Record<string, unknown> {
  try {
    const parte = token.split(".")[1] ?? "";
    return JSON.parse(
      Buffer.from(parte, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function expDoJwt(token: string): number | null {
  const exp = decodeJwt(token).exp;
  return typeof exp === "number" ? exp : null;
}

async function jwtDaSessao(): Promise<string | null> {
  const { data, error } = await neonAuth.token();
  if (error) return null;
  return (data as { token?: string } | null)?.token ?? null;
}

async function sessaoNeonRaw() {
  return neonAuth.getSession();
}

async function sessaoCompat(): Promise<{
  data: { session: Session | null };
  error: unknown;
}> {
  const { data, error } = await sessaoNeonRaw();
  const user = usuarioCompat(data?.user);
  if (error || !user) {
    return { data: { session: null }, error: error ?? null };
  }

  const token = await jwtDaSessao();
  if (!token) return { data: { session: null }, error: null };

  const exp = expDoJwt(token);
  const now = Math.floor(Date.now() / 1000);
  const session: Session = {
    access_token: token,
    refresh_token: "",
    token_type: "bearer",
    expires_in: exp ? Math.max(0, exp - now) : 0,
    expires_at: exp ?? undefined,
    user,
  };

  return { data: { session }, error: null };
}

const mfaIndisponivel = async () => ({
  data: null,
  error: new Error("MFA ainda não habilitado no Neon Auth desta instalação."),
});

function authCompat() {
  return {
    async getUser() {
      const { data, error } = await sessaoNeonRaw();
      return {
        data: { user: usuarioCompat(data?.user) },
        error: error ?? null,
      };
    },

    getSession: sessaoCompat,

    async getClaims() {
      const token = await jwtDaSessao();
      if (!token) return { data: null, error: new Error("Sessão ausente.") };
      const claims = decodeJwt(token);
      const rawSession = await sessaoNeonRaw();
      const session = (rawSession.data as {
        session?: { id?: string };
      } | null)?.session;
      const sessionId =
        claims.session_id ??
        claims.sessionId ??
        claims.sid ??
        session?.id ??
        null;

      return {
        data: {
          claims: {
            ...claims,
            ...(sessionId ? { session_id: sessionId } : {}),
          },
        },
        error: null,
      };
    },

    async signInWithPassword(input: { email: string; password: string }) {
      const result = await neonAuth.signIn.email(input);
      if (result.error) {
        return { data: { user: null, session: null }, error: result.error };
      }
      const current = await sessaoNeonRaw();
      const user = usuarioCompat(current.data?.user);
      const session = (await sessaoCompat()).data.session;
      return { data: { user, session }, error: null };
    },

    async signUp(input: {
      email: string;
      password: string;
      options?: { data?: Record<string, unknown> };
    }) {
      const result = await neonAuth.signUp.email({
        email: input.email,
        password: input.password,
        name:
          typeof input.options?.data?.name === "string"
            ? input.options.data.name
            : input.email,
      });
      return {
        data: {
          user: usuarioCompat(result.data?.user),
          session: null,
        },
        error: result.error ?? null,
      };
    },

    async signOut(_options?: unknown) {
      return neonAuth.signOut();
    },

    async updateUser(attributes: Record<string, unknown>) {
      const mapped = {
        ...(typeof attributes.email === "string"
          ? { email: attributes.email }
          : {}),
        ...(typeof attributes.password === "string"
          ? { password: attributes.password }
          : {}),
        ...(attributes.data &&
        typeof attributes.data === "object" &&
        typeof (attributes.data as Record<string, unknown>).name === "string"
          ? {
              name: (attributes.data as Record<string, string>).name,
            }
          : {}),
      };
      const result = await neonAuth.updateUser(mapped as never);
      if (result.error) {
        return { data: { user: null }, error: result.error };
      }
      const current = await sessaoNeonRaw();
      return {
        data: { user: usuarioCompat(current.data?.user) },
        error: current.error ?? null,
      };
    },

    async resetPasswordForEmail(
      email: string,
      options?: { redirectTo?: string },
    ) {
      return neonAuth.requestPasswordReset({
        email,
        redirectTo: options?.redirectTo,
      } as never);
    },

    async exchangeCodeForSession(_code: string) {
      return sessaoCompat();
    },

    async verifyOtp(_input: unknown) {
      return mfaIndisponivel();
    },

    mfa: {
      async listFactors() {
        return { data: { totp: [] }, error: null };
      },
      async getAuthenticatorAssuranceLevel() {
        return {
          data: { currentLevel: "aal1", nextLevel: "aal1" },
          error: null,
        };
      },
      enroll: mfaIndisponivel,
      challenge: mfaIndisponivel,
      verify: mfaIndisponivel,
      unenroll: mfaIndisponivel,
    },
  };
}

export async function createClient(): Promise<SupabaseClient> {
  const data = createNeonClient({
    dataApi: {
      url: env.NEON_DATA_API_URL,
      getToken: jwtDaSessao,
    },
  });

  return Object.assign(data, { auth: authCompat() }) as unknown as SupabaseClient;
}
