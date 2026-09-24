import "dotenv/config";

import { Client } from "pg";

const connectionString = process.env.MIGRATIONS_DATABASE_URL;
const userId = process.env.NEON_SERVICE_USER_ID;

if (!connectionString) {
  throw new Error("MIGRATIONS_DATABASE_URL ausente.");
}
if (!userId) {
  throw new Error("NEON_SERVICE_USER_ID ausente.");
}

const client = new Client({ connectionString });

try {
  await client.connect();
  await client.query(
    `
      insert into public.neon_service_identities(user_id, kind, active)
      values ($1::uuid, 'server', true)
      on conflict (user_id)
      do update set active = true
    `,
    [userId],
  );
  console.info(
    JSON.stringify({
      ok: true,
      identityRegistered: true,
      secretsPrinted: false,
    }),
  );
} finally {
  await client.end().catch(() => undefined);
}
