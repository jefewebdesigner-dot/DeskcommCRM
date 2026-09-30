/**
 * Cadastra (ou desativa) a identidade técnica do agent-worker PARA uma organização.
 *
 * O worker só enxerga as organizações que têm linha ATIVA em `neon_service_identities` — este é o ato
 * deliberado de "esta organização é atendida pelo worker". Roda com a role dona do banco
 * (`MIGRATIONS_DATABASE_URL`); a role restrita do worker não escreve nessa tabela.
 *
 *   pnpm neon:registrar-worker --org <uuid> [--org <uuid> ...]
 *   pnpm neon:registrar-worker --todas          (todas as organizações ATIVAS — decisão explícita)
 *   pnpm neon:registrar-worker --org <uuid> --desativar
 *
 * Env: MIGRATIONS_DATABASE_URL, NEON_SERVICE_USER_ID (ou WORKER_SERVICE_USER_ID), WORKER_DB_SECRET.
 * Só o HASH do segredo vai ao banco; nada sensível é impresso.
 */
import { createHash } from "node:crypto";

import { Client } from "pg";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function argumentos(): { orgs: string[]; todas: boolean; desativar: boolean } {
  const a = process.argv.slice(2);
  const orgs: string[] = [];
  for (let i = 0; i < a.length; i += 1) if (a[i] === "--org" && a[i + 1]) orgs.push(a[i + 1]!);
  return { orgs, todas: a.includes("--todas"), desativar: a.includes("--desativar") };
}

async function main(): Promise<void> {
  const url = process.env.MIGRATIONS_DATABASE_URL;
  const userId = process.env.WORKER_SERVICE_USER_ID ?? process.env.NEON_SERVICE_USER_ID;
  const secret = process.env.WORKER_DB_SECRET;
  if (!url) throw new Error("MIGRATIONS_DATABASE_URL ausente.");
  if (!userId || !UUID_RX.test(userId)) throw new Error("NEON_SERVICE_USER_ID/WORKER_SERVICE_USER_ID ausente ou inválido.");
  if (!secret || secret.length < 24) throw new Error("WORKER_DB_SECRET ausente ou curto (>= 24).");
  const { orgs, todas, desativar } = argumentos();
  if (!todas && orgs.length === 0) throw new Error("Informe --org <uuid> (repetível) ou --todas.");
  if (orgs.some((o) => !UUID_RX.test(o))) throw new Error("--org precisa ser UUID.");

  const hash = createHash("sha256").update(secret, "utf8").digest("hex");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("begin");
    const alvo = todas
      ? (await client.query<{ id: string }>("select id from public.organizations where status = 'active'")).rows.map((r) => r.id)
      : orgs;
    let n = 0;
    for (const org of alvo) {
      const r = await client.query(
        `insert into public.neon_service_identities(user_id, organization_id, kind, active, secret_sha256)
         values ($1::uuid, $2::uuid, 'server', $3, $4)
         on conflict (user_id, organization_id)
         do update set active = excluded.active, secret_sha256 = excluded.secret_sha256`,
        [userId, org, !desativar, hash],
      );
      n += r.rowCount ?? 0;
    }
    await client.query("commit");
    console.info(JSON.stringify({ ok: true, organizacoes: n, ativo: !desativar, secretsPrinted: false }));
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
