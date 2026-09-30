/**
 * Cifra/decifra de secrets de webhooks (at-rest) — retrofit da spec §10.
 *
 * Reusa a infra do Nuvemshop/WAHA: RPCs `fn_encrypt_oauth`/`fn_decrypt_oauth`
 * (pgp_sym AES-256 com a chave na GUC `app.nuvemshop_oauth_key`). As RPCs têm
 * GRANT apenas para service_role — sempre chame com o admin client.
 *
 * Contrato de erro: encrypt SEM chave configurada retorna null (o caller
 * decide — rotas de escrita respondem 422 com instrução); decrypt que falha
 * retorna null (o caller aplica o precedente WAHA: hmacSkipped, nunca 500).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { Pool } from "pg";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

let poolDireto: Pool | null = null;

function bancoDireto(): Pool {
  if (process.env.NODE_ENV === "test") {
    throw new Error("oauth_postgres_fallback_disabled_in_test");
  }
  if (!poolDireto) {
    poolDireto = new Pool({
      connectionString: env.DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
      statement_timeout: 10_000,
    });
    poolDireto.on("error", () => undefined);
  }
  return poolDireto;
}

function erroDeCompatibilidade(message: string | undefined): boolean {
  return Boolean(
    message &&
      (/Could not find the function|does not exist|permission denied|rpc_indisponivel/i.test(
        message,
      )),
  );
}

async function encryptDireto(plaintext: string): Promise<string | null> {
  const r = await bancoDireto().query<{ value: Buffer }>(
    "select public.fn_service_encrypt_oauth($1) as value",
    [plaintext],
  );
  const value = r.rows[0]?.value;
  return value ? `\\x${value.toString("hex")}` : null;
}

async function decryptDireto(ciphertext: string): Promise<string | null> {
  const normalized = ciphertext.startsWith("\\x") ? ciphertext : `\\x${ciphertext}`;
  const r = await bancoDireto().query<{ value: string }>(
    "select public.fn_service_decrypt_oauth($1::bytea) as value",
    [normalized],
  );
  return r.rows[0]?.value ?? null;
}

/** Cifra um secret. Retorna o bytea (formato hex "\x…" do PostgREST) ou null se a chave estiver ausente/erro. */
export async function encryptWebhookSecret(
  admin: SupabaseClient,
  plaintext: string,
): Promise<string | null> {
  let resposta =
    typeof admin.rpc === "function"
      ? await admin.rpc("fn_service_encrypt_oauth", { plaintext })
      : { data: null, error: { message: "rpc_indisponivel" } };
  if (
    typeof admin.rpc === "function" &&
    resposta.error &&
    (/function .*fn_service_encrypt_oauth.*does not exist|Could not find the function/i.test(
      resposta.error.message,
    ) ||
      resposta.error.message === "rpc_indisponivel")
  ) {
    resposta = await admin.rpc("fn_encrypt_oauth", { plaintext });
  }
  const { data, error } = resposta;
  if (error || !data) {
    if (erroDeCompatibilidade(error?.message ?? "rpc_indisponivel")) {
      try {
        return await encryptDireto(plaintext);
      } catch (fallbackError) {
        logger.warn("[webhooks.secrets] encrypt direto no Neon falhou", {
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
      }
    }
    logger.warn("[webhooks.secrets] encrypt falhou (GUC app.nuvemshop_oauth_key ausente?)", {
      error: error?.message ?? "empty",
    });
    return null;
  }
  return data as string;
}

/** Decifra um secret cifrado (bytea hex ou hex puro de jsonb). null em falha. */
export async function decryptWebhookSecret(
  admin: SupabaseClient,
  ciphertext: string,
): Promise<string | null> {
  const normalized = ciphertext.startsWith("\\x") ? ciphertext : `\\x${ciphertext}`;
  let resposta =
    typeof admin.rpc === "function"
      ? await admin.rpc("fn_service_decrypt_oauth", { ciphertext: normalized })
      : { data: null, error: { message: "rpc_indisponivel" } };
  if (
    typeof admin.rpc === "function" &&
    resposta.error &&
    (/function .*fn_service_decrypt_oauth.*does not exist|Could not find the function/i.test(
      resposta.error.message,
    ) ||
      resposta.error.message === "rpc_indisponivel")
  ) {
    resposta = await admin.rpc("fn_decrypt_oauth", { ciphertext: normalized });
  }
  const { data, error } = resposta;
  if (error || !data) {
    if (erroDeCompatibilidade(error?.message ?? "rpc_indisponivel")) {
      try {
        return await decryptDireto(normalized);
      } catch {
        return null;
      }
    }
    return null;
  }
  return data as string;
}

export interface RuleActionInput {
  type: string;
  config?: Record<string, unknown>;
}

/**
 * Troca `config.secret` (plaintext, input do editor) por `config.secret_enc`
 * (hex cifrado) em ações call_webhook antes de gravar no jsonb da regra.
 * `secret_enc` já presente (round-trip do editor sem re-digitar) passa direto.
 * Retorna null se a cifra estiver indisponível (caller responde 422).
 */
export async function encryptRuleActionSecrets(
  admin: SupabaseClient,
  actions: RuleActionInput[],
): Promise<RuleActionInput[] | null> {
  const out: RuleActionInput[] = [];
  for (const action of actions) {
    if (action.type === "call_webhook" && typeof action.config?.secret === "string" && action.config.secret) {
      const enc = await encryptWebhookSecret(admin, action.config.secret);
      if (enc === null) return null;
      const { secret: _plain, ...restConfig } = action.config;
      out.push({ ...action, config: { ...restConfig, secret_enc: enc.replace(/^\\x/, "") } });
    } else {
      const { secret: _drop, ...restConfig } = action.config ?? {};
      out.push({ ...action, config: restConfig });
    }
  }
  return out;
}
