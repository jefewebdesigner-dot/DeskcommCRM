/**
 * Semeia o playbook de PLATAFORMA (linha global, organization_id nulo) com a role DONA do banco.
 *
 * O agent-worker roda com a role restrita e NÃO escreve dado global (de propósito): ele só verifica
 * que o playbook existe e, se não existir, para com erro operacional. Este script é o ato de deploy
 * que cria a primeira versão a partir de `lib/agent-engine/playbooks/platform.md` — mesma função e
 * mesmo arquivo do boot do worker no self-host. Não move ponteiro existente (regra dura nº 10).
 *
 *   pnpm neon:semear-playbook      (env: MIGRATIONS_DATABASE_URL)
 */
import pg from "pg";

import { seedPlatformPlaybook } from "@/lib/agent-engine/agent/playbook-seed";

async function main(): Promise<void> {
  const url = process.env.MIGRATIONS_DATABASE_URL;
  if (!url) throw new Error("MIGRATIONS_DATABASE_URL ausente.");
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const r = await seedPlatformPlaybook(pool);
    console.info(JSON.stringify({ ok: true, resultado: r }));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
