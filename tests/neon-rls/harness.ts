/**
 * Base comum das provas de handler sob RLS (harness Docker com o schema de produção).
 *
 * Duas conexões, dois papéis — e a diferença é o ponto:
 *   - `dono`: o superusuário do container, só para SEMEAR e para CONFERIR o que o worker gravou;
 *   - `tenant`: o pool do worker de verdade — role restrita `gravity_app_*`, sem BYPASSRLS, contexto de
 *     organização por transação. Tudo que o código de produção faz passa por ele.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import pg from 'pg';

import { createTenantPool, type TenantPool } from '@/lib/agent-engine/db/tenant-pool';

export const DONO_URL = process.env.RLS_DB_DONO;
export const APP_URL = process.env.RLS_DB_APP;
export const habilitado = Boolean(DONO_URL && APP_URL);

export const MIGRATIONS_DO_WORKER = [
  '20260930_0015_worker_org_context.sql',
  '20260930_0016_worker_status_para_o_health.sql',
  '20260930_0017_gravity_app_executa_funcoes_das_policies.sql',
  '20260930_0018_worker_rpcs_do_motor.sql',
];

export interface Mundo {
  dono: pg.Pool;
  appBase: pg.Pool;
  tenant: TenantPool;
  serviceUserId: string;
  fim(): Promise<void>;
  /** Cria a organização e cadastra a identidade do worker PARA ela (o ato deliberado de produção). */
  registrarOrg(orgId: string, slug: string): Promise<void>;
}

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export async function criarMundo(): Promise<Mundo> {
  const segredo = randomBytes(24).toString('hex');
  const serviceUserId = randomUUID();
  const dono = new pg.Pool({ connectionString: DONO_URL, max: 3 });
  const appBase = new pg.Pool({ connectionString: APP_URL, max: 8 });
  const tenant = createTenantPool(appBase, { serviceUserId, secret: segredo });
  for (const m of MIGRATIONS_DO_WORKER) {
    await dono.query(readFileSync(resolve(process.cwd(), 'neon/migrations', m), 'utf8'));
  }
  await dono.query(`insert into neon_auth."user"(id, email, name, "emailVerified") values ($1, $2, 'servico', true)`, [serviceUserId, `svc-${serviceUserId}@teste.local`]);
  // playbook de plataforma: o worker só VERIFICA; quem semeia é o deploy (aqui, o dono)
  await dono.query(`delete from playbook_pointers where organization_id is null`);
  await dono.query(`delete from playbook_versions where organization_id is null`);
  const v = await dono.query<{ id: string }>(
    `insert into playbook_versions(organization_id, layer, content) values (null, 'platform', E'## Identidade\\nAssistente de teste.') returning id`,
  );
  await dono.query(`insert into playbook_pointers(organization_id, layer, version_id) values (null, 'platform', $1)`, [v.rows[0]!.id]);
  return {
    dono,
    appBase,
    tenant,
    serviceUserId,
    fim: async () => {
      await Promise.all([dono.end(), appBase.end()]);
    },
    registrarOrg: async (orgId, slug) => {
      await dono.query(`insert into organizations(id, slug, legal_name, display_name) values ($1, $2, $3, $3)`, [orgId, slug, `Org ${slug}`]);
      await dono.query(
        `insert into neon_service_identities(user_id, organization_id, kind, active, secret_sha256) values ($1, $2, 'server', true, $3)`,
        [serviceUserId, orgId, sha(segredo)],
      );
    },
  };
}

export const logSilencioso = { info: () => undefined, warn: () => undefined, error: () => undefined };

export async function contar(pool: pg.Pool, tabela: string, org: string, extra = ''): Promise<number> {
  const r = await pool.query<{ n: number }>(`select count(*)::int n from ${tabela} where organization_id = $1 ${extra}`, [org]);
  return Number(r.rows[0]!.n);
}
