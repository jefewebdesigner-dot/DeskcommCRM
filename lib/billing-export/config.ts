import "server-only";

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { z } from "zod";

import { env } from "@/lib/env";
import { Pool, type PoolClient } from "pg";

const PURPOSE = "billing-export-v1";
const orgSchema = z.uuid();
const tokenSchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[\x21-\x7e]+$/);

function key(): Buffer {
  return Buffer.from(hkdfSync("sha256", env.NEON_AUTH_COOKIE_SECRET, PURPOSE, PURPOSE, 32));
}

/** Version, random nonce, authentication tag and ciphertext; never plaintext. */
export function encryptToken(organizationId: string, token: string): string {
  orgSchema.parse(organizationId);
  tokenSchema.parse(token);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(organizationId));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decryptToken(organizationId: string, envelope: string): string {
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
    return tokenSchema.parse(
      Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"),
    );
  } catch {
    // No upstream, crypto or database details can contain the credential.
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
      /* Request failures are surfaced through the API. */
    });
  }
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    await client.query("select set_config('app.billing_export_org', $1, true)", [organizationId]);
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch {
    try {
      await client.query("ROLLBACK");
    } catch {
      discard = true;
    }
    throw new Error("Não foi possível acessar a conexão de faturamento.");
  } finally {
    client.release(discard);
  }
}

/** Session/RBAC is verified by the route; SQL scope is transaction-local. */
export async function readConnection(
  organizationId: string,
): Promise<{ token: string; updated_at: string } | null> {
  return withOrganization(organizationId, async (client) => {
    const exists = await client.query<{ installed: boolean }>(
      "select to_regclass('public.billing_export_connections') is not null as installed",
    );
    if (!exists.rows[0]?.installed) return null;
    const result = await client.query<{ encrypted_token: string; updated_at: Date }>(
      "select encrypted_token, updated_at from public.billing_export_connections where organization_id = $1",
      [organizationId],
    );
    const row = result.rows[0];
    return row
      ? {
          token: decryptToken(organizationId, row.encrypted_token),
          updated_at: new Date(row.updated_at).toISOString(),
        }
      : null;
  });
}

export async function saveConnection(organizationId: string, token: string): Promise<void> {
  const encrypted = encryptToken(organizationId, token);
  await withOrganization(organizationId, async (client) => {
    await client.query(
      `insert into public.billing_export_connections (organization_id, encrypted_token, updated_at)
      values ($1, $2, now()) on conflict (organization_id) do update set encrypted_token = excluded.encrypted_token, updated_at = excluded.updated_at`,
      [organizationId, encrypted],
    );
  });
}

export async function removeConnection(organizationId: string): Promise<void> {
  await withOrganization(organizationId, async (client) => {
    await client.query("delete from public.billing_export_connections where organization_id = $1", [
      organizationId,
    ]);
  });
}
