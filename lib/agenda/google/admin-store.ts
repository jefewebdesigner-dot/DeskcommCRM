import "server-only";

import { Pool } from "pg";

import { env } from "@/lib/env";

export interface LinhaDoAppDoGoogle {
  client_id: string | null;
  client_secret_encrypted: string | null;
  updated_at: string | null;
}

let pool: Pool | null = null;

function banco(): Pool {
  if (process.env.NODE_ENV === "test") {
    throw new Error("agenda_google_postgres_fallback_disabled_in_test");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
      statement_timeout: 10_000,
    });
    pool.on("error", () => undefined);
  }
  return pool;
}

function byteaHex(value: Buffer | string | null): string | null {
  if (value === null) return null;
  if (Buffer.isBuffer(value)) return `\\x${value.toString("hex")}`;
  return value.startsWith("\\x") ? value : `\\x${value}`;
}

export async function lerAppDoGoogleNoPostgres(): Promise<LinhaDoAppDoGoogle | null> {
  const result = await banco().query<{
    client_id: string | null;
    client_secret_encrypted: Buffer | string | null;
    updated_at: Date | string | null;
  }>(
    "select client_id, client_secret_encrypted, updated_at from public.fn_platform_google_oauth_get()",
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    client_id: row.client_id,
    client_secret_encrypted: byteaHex(row.client_secret_encrypted),
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export async function salvarAppDoGoogleNoPostgres(input: {
  clientId: string;
  clientSecretEncrypted?: string | null;
  updatedBy?: string | null;
}): Promise<void> {
  await banco().query(
    "select public.fn_platform_google_oauth_put($1, $2::bytea, $3::uuid)",
    [input.clientId, input.clientSecretEncrypted ?? null, input.updatedBy ?? null],
  );
}
