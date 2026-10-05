import "server-only";

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { z } from "zod";

import { env } from "@/lib/env";
import { Pool, type PoolClient } from "pg";

/**
 * Guarda a chave de API da AbacatePay — mesmo envelope de
 * `lib/billing-export/config.ts`, com `PURPOSE` diferente de propósito: as
 * duas chaves derivadas da mesma secret nunca decifram a credencial uma da
 * outra, mesmo que algum dia compartilhem a mesma tabela por engano.
 */
const PURPOSE = "abacatepay-connection-v1";
const orgSchema = z.uuid();
const apiKeySchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[\x21-\x7e]+$/);

function key(): Buffer {
  return Buffer.from(hkdfSync("sha256", env.NEON_AUTH_COOKIE_SECRET, PURPOSE, PURPOSE, 32));
}

export function encryptApiKey(organizationId: string, apiKey: string): string {
  orgSchema.parse(organizationId);
  apiKeySchema.parse(apiKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(organizationId));
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decryptApiKey(organizationId: string, envelope: string): string {
  orgSchema.parse(organizationId);
  try {
    const parts = envelope.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") throw new Error();
    const encoded = parts.slice(1);
    if (encoded.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
    const [iv, tag, ciphertext] = encoded.map((part) => Buffer.from(part, "base64url"));
    if (!iv || iv.length !== 12 || !tag || tag.length !== 16 || !ciphertext) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAAD(Buffer.from(organizationId));
    decipher.setAuthTag(tag);
    return apiKeySchema.parse(
      Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"),
    );
  } catch {
    // Nenhum detalhe de banco/cripto pode viajar até quem chama.
    throw new Error("Não foi possível abrir a credencial. Reconecte a integração.");
  }
}

let pool: Pool | undefined;

async function withOrganization<T>(
  organizationId: string,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  orgSchema.parse(organizationId);
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      statement_timeout: 10000,
    });
    pool.on("error", () => {
      /* Falhas de requisição aparecem na resposta da rota. */
    });
  }
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    // A policy de RLS (migration 0359) só libera a linha cujo organization_id
    // bate com este config, setado LOCAL à transação — sem isto, toda escrita
    // nesta tabela cai em "new row violates row-level security policy" mesmo
    // com o GRANT de tabela concedido (RLS filtra silenciosamente em SELECT,
    // mas recusa alto em INSERT/UPDATE sem WITH CHECK satisfeito).
    await client.query("select set_config('app.abacatepay_org', $1, true)", [organizationId]);
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch {
    try {
      await client.query("ROLLBACK");
    } catch {
      discard = true;
    }
    throw new Error("Não foi possível acessar a conexão com a AbacatePay.");
  } finally {
    client.release(discard);
  }
}

export interface AbacatePayConnection {
  apiKey: string;
  storeId: string | null;
  storeName: string | null;
  updatedAt: string;
}

export async function readConnection(organizationId: string): Promise<AbacatePayConnection | null> {
  return withOrganization(organizationId, async (client) => {
    const result = await client.query<{
      encrypted_api_key: string;
      store_id: string | null;
      store_name: string | null;
      updated_at: Date;
    }>(
      "select encrypted_api_key, store_id, store_name, updated_at from public.abacatepay_connections where organization_id = $1",
      [organizationId],
    );
    const row = result.rows[0];
    return row
      ? {
          apiKey: decryptApiKey(organizationId, row.encrypted_api_key),
          storeId: row.store_id,
          storeName: row.store_name,
          updatedAt: new Date(row.updated_at).toISOString(),
        }
      : null;
  });
}

export async function saveConnection(
  organizationId: string,
  apiKey: string,
  store: { id: string | null; name: string | null },
): Promise<void> {
  const encrypted = encryptApiKey(organizationId, apiKey);
  await withOrganization(organizationId, async (client) => {
    await client.query(
      `insert into public.abacatepay_connections (organization_id, encrypted_api_key, store_id, store_name, updated_at)
      values ($1, $2, $3, $4, now())
      on conflict (organization_id) do update set
        encrypted_api_key = excluded.encrypted_api_key,
        store_id = excluded.store_id,
        store_name = excluded.store_name,
        updated_at = excluded.updated_at`,
      [organizationId, encrypted, store.id, store.name],
    );
  });
}

export async function removeConnection(organizationId: string): Promise<void> {
  await withOrganization(organizationId, async (client) => {
    await client.query("delete from public.abacatepay_connections where organization_id = $1", [
      organizationId,
    ]);
  });
}
