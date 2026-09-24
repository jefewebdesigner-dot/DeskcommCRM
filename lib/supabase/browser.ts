"use client";

/**
 * Cliente browser compatível durante a migração Supabase -> Neon.
 *
 * O SDK oficial do Neon expõe Data API + Neon Auth e o SupabaseAuthAdapter
 * conserva a superfície de auth que a UI já usa. Realtime é tratado pelo hook
 * compartilhado via polling RLS, não por sockets Supabase.
 */
import {
  createClient as createNeonClient,
  SupabaseAuthAdapter,
} from "@neondatabase/neon-js";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

function configPublica() {
  const runtime =
    typeof window !== "undefined" ? window.__PUBLIC_ENV__ : undefined;
  const authUrl =
    runtime?.NEON_AUTH_BASE_URL ?? process.env.NEXT_PUBLIC_NEON_AUTH_BASE_URL;
  const dataApiUrl =
    runtime?.NEON_DATA_API_URL ?? process.env.NEXT_PUBLIC_NEON_DATA_API_URL;

  if (!authUrl || !dataApiUrl) {
    throw new Error(
      "[neon/browser] NEON_AUTH_BASE_URL ou NEON_DATA_API_URL ausentes.",
    );
  }
  return { authUrl, dataApiUrl };
}

export function createClient() {
  if (client) return client;
  const { authUrl, dataApiUrl } = configPublica();

  const neon = createNeonClient({
    auth: {
      adapter: SupabaseAuthAdapter(),
      url: authUrl,
    },
    dataApi: {
      url: dataApiUrl,
    },
  });
  client = neon as unknown as SupabaseClient;
  return client;
}

/**
 * Compatibilidade com o hook antigo. Agora a própria sessão Neon fornece o JWT
 * para a Data API; esta função só comprova que existe uma sessão autenticada.
 */
export async function prepareRealtimeAuthentication(): Promise<void> {
  const {
    data: { session },
  } = await createClient().auth.getSession();
  if (!session?.access_token) {
    throw new Error("Autenticação Neon indisponível.");
  }
}

export function resetRealtimeAuthentication(): void {
  // Neon Auth já invalida/sincroniza o cache ao fazer sign-out.
}

export const __resetTokenDoRealtime = resetRealtimeAuthentication;
