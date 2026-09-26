import { Client } from "pg";

import { PREFIXO_FIXTURE } from "./guarda-ambiente";
import { signUpEmail } from "./cliente-neon-auth";

export type AtorABC = { label: "A" | "B" | "C"; userId: string; email: string; password: string; orgId: string | null };

export type FixturesABC = {
  A: AtorABC;
  B: AtorABC;
  C: AtorABC;
};

const SENHA = "E2eHomolog!2026xyz";

function client(): Client {
  const url = process.env.MIGRATIONS_DATABASE_URL;
  if (!url) throw new Error("MIGRATIONS_DATABASE_URL ausente");
  return new Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
}

/** Cria 3 usuários Neon Auth reais + 2 organizações sintéticas. A e B admin cada um da própria; C sem vínculo. */
export async function criarFixturesABC(): Promise<FixturesABC> {
  const stamp = Date.now();
  const emailA = `${PREFIXO_FIXTURE}-a-${stamp}@example.test`;
  const emailB = `${PREFIXO_FIXTURE}-b-${stamp}@example.test`;
  const emailC = `${PREFIXO_FIXTURE}-c-${stamp}@example.test`;

  const userIdA = await signUpEmail(emailA, SENHA, "E2E Neon Homolog A");
  const userIdB = await signUpEmail(emailB, SENHA, "E2E Neon Homolog B");
  const userIdC = await signUpEmail(emailC, SENHA, "E2E Neon Homolog C");

  const c = client();
  await c.connect();
  try {
    await c.query("BEGIN");
    const insOrg = async (slug: string, legal: string): Promise<string> => {
      const r = await c.query(
        `insert into public.organizations (slug, legal_name, display_name) values ($1, $2, $2) returning id`,
        [slug, legal],
      );
      return r.rows[0].id as string;
    };
    const orgA = await insOrg(`${PREFIXO_FIXTURE}-org-a-${stamp}`, `E2E Homolog Org A ${stamp}`);
    const orgB = await insOrg(`${PREFIXO_FIXTURE}-org-b-${stamp}`, `E2E Homolog Org B ${stamp}`);

    await c.query(
      `insert into public.user_organizations (user_id, organization_id, role, accepted_at) values ($1, $2, 'admin', now())`,
      [userIdA, orgA],
    );
    await c.query(
      `insert into public.user_organizations (user_id, organization_id, role, accepted_at) values ($1, $2, 'admin', now())`,
      [userIdB, orgB],
    );
    await c.query("COMMIT");

    return {
      A: { label: "A", userId: userIdA, email: emailA, password: SENHA, orgId: orgA },
      B: { label: "B", userId: userIdB, email: emailB, password: SENHA, orgId: orgB },
      C: { label: "C", userId: userIdC, email: emailC, password: SENHA, orgId: null },
    };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    await c.end();
  }
}

/** Apaga SOMENTE o que foi criado por `criarFixturesABC` — orgs (cascata cuida do resto) + os 3 usuários. */
export async function limparFixturesABC(f: FixturesABC): Promise<void> {
  const c = client();
  await c.connect();
  try {
    const orgIds = [f.A.orgId, f.B.orgId].filter((x): x is string => !!x);
    if (orgIds.length > 0) {
      await c.query(`delete from public.organizations where id = any($1::uuid[])`, [orgIds]);
    }
    const userIds = [f.A.userId, f.B.userId, f.C.userId];
    await c.query(`delete from neon_auth."user" where id = any($1::uuid[])`, [userIds]);
  } finally {
    await c.end();
  }
}
