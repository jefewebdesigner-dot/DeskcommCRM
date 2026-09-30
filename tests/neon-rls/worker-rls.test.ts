/**
 * Prova de banco REAL do contexto de organização do agent-worker (migration Neon 0015).
 *
 * Roda contra o harness `scripts/neon/rls-harness.sh` (schema de produção, role restrita
 * `gravity_app_*`, sem BYPASSRLS). Sem `RLS_DB_DONO`/`RLS_DB_APP` no ambiente o arquivo inteiro é
 * pulado — a suíte comum não precisa de Docker.
 *
 *   eval "$(scripts/neon/rls-harness.sh url | sed 's/^/export /')" && pnpm vitest run tests/neon-rls
 */
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTenantPool, TenantContextError, type TenantPool } from '@/lib/agent-engine/db/tenant-pool';

const DONO = process.env.RLS_DB_DONO;
const APP = process.env.RLS_DB_APP;
const suite = DONO && APP ? describe : describe.skip;

const SEGREDO = randomBytes(24).toString('hex');
const UID = randomUUID();
const ORG_A = randomUUID();
const ORG_B = randomUUID();
const ORG_SUSPENSA = randomUUID();
const ORG_SEM_CADASTRO = randomUUID();
const USUARIO_HUMANO = randomUUID();

let dono: pg.Pool;
let appBase: pg.Pool; // várias conexões
let app1: pg.Pool; // UMA conexão: força reuso da mesma conexão física
let tenant: TenantPool;
let tenant1: TenantPool;

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

async function contagem(pool: pg.Pool | TenantPool, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

suite('agent-worker — contexto de organização por transação (RLS real)', () => {
  beforeAll(async () => {
    dono = new pg.Pool({ connectionString: DONO, max: 2 });
    appBase = new pg.Pool({ connectionString: APP, max: 8 });
    app1 = new pg.Pool({ connectionString: APP, max: 1 });
    tenant = createTenantPool(appBase, { serviceUserId: UID, secret: SEGREDO });
    tenant1 = createTenantPool(app1, { serviceUserId: UID, secret: SEGREDO });

    // O teste aplica as migrations DO REPOSITÓRIO (idempotentes) — o harness pode ter só o schema de produção.
    for (const m of ['20260930_0015_worker_org_context.sql', '20260930_0016_worker_status_para_o_health.sql']) {
      await dono.query(readFileSync(resolve(process.cwd(), 'neon/migrations', m), 'utf8'));
    }
    await dono.query(`insert into neon_auth."user"(id, email, name, "emailVerified") values ($1, $2, 'servico', true), ($3, $4, 'humano', true)`, [
      UID, `svc-${UID}@teste.local`, USUARIO_HUMANO, `hum-${USUARIO_HUMANO}@teste.local`,
    ]);
    for (const [id, status] of [
      [ORG_A, 'active'], [ORG_B, 'active'], [ORG_SUSPENSA, 'suspended'], [ORG_SEM_CADASTRO, 'active'],
    ] as const) {
      await dono.query(
        `insert into organizations(id, slug, legal_name, display_name, status) values ($1, $2, $3, $3, $4)`,
        [id, `org-${id.slice(0, 8)}`, `Org ${id.slice(0, 8)}`, status],
      );
    }
    // Cadastro técnico POR ORGANIZAÇÃO: A, B e a suspensa. A org sem cadastro fica de fora de propósito.
    for (const org of [ORG_A, ORG_B, ORG_SUSPENSA]) {
      await dono.query(
        `insert into neon_service_identities(user_id, organization_id, kind, active, secret_sha256) values ($1, $2, 'server', true, $3)`,
        [UID, org, sha(SEGREDO)],
      );
    }
    await dono.query(`insert into user_organizations(user_id, organization_id, role) values ($1, $2, 'admin')`, [USUARIO_HUMANO, ORG_A]);
    for (const org of [ORG_A, ORG_B, ORG_SUSPENSA, ORG_SEM_CADASTRO]) {
      await dono.query(`insert into crm_pipelines(organization_id, name, slug) values ($1, 'Funil', $2)`, [org, `funil-${org.slice(0, 8)}`]);
      await dono.query(`insert into contacts(organization_id) values ($1)`, [org]);
      await dono.query(`insert into job_queue(organization_id, kind, run_after) values ($1, 'watchdog', now() - interval '1 minute')`, [org]);
    }
    // harness descartável: parte de um playbook global limpo (rodadas anteriores podem ter deixado um)
    await dono.query(`delete from playbook_pointers where organization_id is null`);
    await dono.query(`delete from playbook_versions where organization_id is null`);
    const { rows } = await dono.query<{ id: string }>(
      `insert into playbook_versions(organization_id, layer, content) values (null, 'platform', 'playbook de plataforma') returning id`,
    );
    await dono.query(`insert into playbook_pointers(organization_id, layer, version_id) values (null, 'platform', $1)`, [rows[0]!.id]);
  });

  afterAll(async () => {
    await Promise.all([dono?.end(), appBase?.end(), app1?.end()]);
  });

  // ── Tenant A ────────────────────────────────────────────────────────────────────────────
  it('A lê A e escreve A', async () => {
    await tenant.withOrganization(ORG_A, async () => {
      // a criação da organização já semeia o funil padrão: a verdade é a contagem do dono
      const esperado = await contagem(dono, `select count(*) n from crm_pipelines where organization_id = $1`, [ORG_A]);
      expect(await contagem(tenant, `select count(*) n from crm_pipelines`)).toBe(esperado);
      const { rows } = await tenant.query<{ organization_id: string }>(`select distinct organization_id from crm_pipelines`);
      expect(rows.map((r) => r.organization_id)).toEqual([ORG_A]);
      await tenant.query(`insert into crm_pipelines(organization_id, name, slug) values ($1, 'Novo A', 'novo-a')`, [ORG_A]);
      const up = await tenant.query(`update crm_pipelines set name = 'Renomeado' where slug = 'novo-a'`);
      expect(up.rowCount).toBe(1);
    });
  });

  // ── Tenant B ────────────────────────────────────────────────────────────────────────────
  it('B lê B e escreve B', async () => {
    await tenant.withOrganization(ORG_B, async () => {
      const { rows } = await tenant.query<{ organization_id: string }>(`select distinct organization_id from crm_pipelines`);
      expect(rows.map((r) => r.organization_id)).toEqual([ORG_B]);
      const antes = await contagem(tenant, `select count(*) n from crm_pipelines`);
      await tenant.query(`insert into crm_pipelines(organization_id, name, slug) values ($1, 'Novo B', 'novo-b')`, [ORG_B]);
      expect(await contagem(tenant, `select count(*) n from crm_pipelines`)).toBe(antes + 1);
    });
  });

  // ── A tentando B ────────────────────────────────────────────────────────────────────────
  it('A tentando B: SELECT invisível, INSERT/UPDATE/DELETE negados', async () => {
    await tenant.withOrganization(ORG_A, async () => {
      expect(await contagem(tenant, `select count(*) n from crm_pipelines where organization_id = $1`, [ORG_B])).toBe(0);
      expect(await contagem(tenant, `select count(*) n from job_queue where organization_id = $1`, [ORG_B])).toBe(0);
      await expect(
        tenant.query(`insert into crm_pipelines(organization_id, name, slug) values ($1, 'Invasor', 'invasor')`, [ORG_B]),
      ).rejects.toMatchObject({ code: '42501' }); // row-level security violation
      const up = await tenant.query(`update crm_pipelines set name = 'hackeado' where organization_id = $1`, [ORG_B]);
      expect(up.rowCount).toBe(0);
      const del = await tenant.query(`delete from crm_pipelines where organization_id = $1`, [ORG_B]);
      expect(del.rowCount).toBe(0);
      // e mover uma linha de A para B também é negado (WITH CHECK)
      await expect(tenant.query(`update crm_pipelines set organization_id = $1 where slug = 'novo-a'`, [ORG_B])).rejects.toMatchObject({ code: '42501' });
    });
    // B continua intacto, visto pelo dono
    expect(await contagem(dono, `select count(*) n from crm_pipelines where organization_id = $1 and name = 'hackeado'`, [ORG_B])).toBe(0);
    expect(await contagem(dono, `select count(*) n from crm_pipelines where organization_id = $1 and slug = 'novo-b'`, [ORG_B])).toBe(1);
  });

  // ── Sem contexto ────────────────────────────────────────────────────────────────────────
  it('sem contexto: o pool do worker lança em vez de devolver "zero linhas" em silêncio', async () => {
    await expect(tenant.query(`select count(*) from crm_pipelines`)).rejects.toBeInstanceOf(TenantContextError);
    await expect(tenant.connect()).rejects.toBeInstanceOf(TenantContextError);
  });

  it('sem contexto, pelo pool CRU: dado de tenant e plataforma invisíveis', async () => {
    for (const tabela of ['crm_pipelines', 'contacts', 'job_queue', 'organizations', 'playbook_pointers', 'neon_service_identities']) {
      const r = await appBase.query(`select count(*)::int n from public.${tabela}`).catch((e: { code?: string }) => ({ rows: [{ n: `erro:${e.code}` }] }));
      expect([0, 'erro:42501']).toContain(r.rows[0]!.n);
    }
  });

  // ── Identidade errada ───────────────────────────────────────────────────────────────────
  it('segredo errado, identidade errada ou organização sem cadastro/suspensa: nada é visível', async () => {
    const errado = createTenantPool(appBase, { serviceUserId: UID, secret: randomBytes(24).toString('hex') });
    const outro = createTenantPool(appBase, { serviceUserId: randomUUID(), secret: SEGREDO });
    for (const pool of [errado, outro]) {
      await pool.withOrganization(ORG_A, async () => {
        expect(await contagem(pool, `select count(*) n from crm_pipelines`)).toBe(0);
        await expect(pool.query(`insert into crm_pipelines(organization_id, name, slug) values ($1, 'x', 'x')`, [ORG_A])).rejects.toMatchObject({ code: '42501' });
      });
    }
    for (const org of [ORG_SEM_CADASTRO, ORG_SUSPENSA]) {
      await tenant.withOrganization(org, async () => {
        expect(await contagem(tenant, `select count(*) n from crm_pipelines`)).toBe(0);
        expect(await contagem(tenant, `select count(*) n from job_queue`)).toBe(0);
      });
    }
  });

  it('UUID de organização malformado no banco nunca vira erro de cast nem acesso', async () => {
    const raw = await appBase.connect();
    try {
      await raw.query(`begin; select set_config('app.worker_uid','${UID}',true), set_config('app.worker_secret','${SEGREDO}',true), set_config('app.worker_org','nao-e-uuid',true)`);
      const r = await raw.query(`select public.fn_worker_org() o, (select count(*)::int from crm_pipelines) n`);
      expect(r.rows[0]).toEqual({ o: null, n: 0 });
      await raw.query('rollback');
    } finally {
      raw.release();
    }
  });

  // ── Contexto encerrado ──────────────────────────────────────────────────────────────────
  it('contexto encerrado: a MESMA conexão física, reutilizada, não guarda a organização anterior', async () => {
    const pid = async () => Number((await app1.query<{ p: number }>('select pg_backend_pid() p')).rows[0]!.p);
    const antes = await pid();
    await tenant1.withOrganization(ORG_A, async () => {
      expect(await contagem(tenant1, `select count(*) n from crm_pipelines`)).toBeGreaterThan(0);
    });
    expect(await pid()).toBe(antes); // mesma conexão
    const { rows } = await app1.query<{ uid: string | null; org: string | null; n: number }>(
      `select nullif(current_setting('app.worker_uid', true), '') uid, nullif(current_setting('app.worker_org', true), '') org, (select count(*)::int from crm_pipelines) n`,
    );
    expect(rows[0]).toEqual({ uid: null, org: null, n: 0 });
  });

  // ── Concorrência ────────────────────────────────────────────────────────────────────────
  it('A e B em paralelo na mesma pool: nenhum contexto contamina outro job', async () => {
    const trabalho = async (org: string, i: number) => {
      const esperado = org;
      return tenant.withOrganization(org, async () => {
        const vistos = new Set<string>();
        for (let k = 0; k < 4; k++) {
          const { rows } = await tenant.query<{ organization_id: string }>(`select organization_id from crm_pipelines`);
          rows.forEach((r) => vistos.add(r.organization_id));
          await new Promise((r) => setTimeout(r, 5 + ((i * 7 + k * 3) % 11)));
        }
        return { esperado, vistos: [...vistos] };
      });
    };
    const resultados = await Promise.all(Array.from({ length: 40 }, (_, i) => trabalho(i % 2 === 0 ? ORG_A : ORG_B, i)));
    for (const r of resultados) expect(r.vistos).toEqual([r.esperado]);
  });

  it('unidades atômicas concorrentes de A e B usam cada uma a sua conexão e não se misturam', async () => {
    const unidade = (org: string) =>
      tenant.withOrganizationTransaction(org, async (client) => {
        const pid1 = (await client.query<{ p: number }>('select pg_backend_pid() p')).rows[0]!.p;
        await new Promise((r) => setTimeout(r, 15));
        const viaPool = (await tenant.query<{ p: number }>('select pg_backend_pid() p')).rows[0]!.p; // roteado para a MESMA conexão
        const orgs = (await client.query<{ organization_id: string }>('select distinct organization_id from crm_pipelines')).rows.map((r) => r.organization_id);
        return { pid1, viaPool, orgs };
      });
    const rs = await Promise.all([unidade(ORG_A), unidade(ORG_B), unidade(ORG_A), unidade(ORG_B)]);
    for (const [i, r] of rs.entries()) {
      expect(r.viaPool).toBe(r.pid1);
      expect(r.orgs).toEqual([i % 2 === 0 ? ORG_A : ORG_B]);
    }
  });

  // ── Semântica de transação preservada ───────────────────────────────────────────────────
  it('pool.query avulso faz autocommit: outra conexão enxerga na hora', async () => {
    await tenant.withOrganization(ORG_A, () => tenant.query(`insert into crm_pipelines(organization_id, name, slug) values ($1, 'Autocommit', 'autocommit')`, [ORG_A]));
    expect(await contagem(dono, `select count(*) n from crm_pipelines where organization_id = '${ORG_A}' and slug = 'autocommit'`)).toBe(1);
  });

  it('pool.connect(): begin/commit do código recebem o contexto; rollback desfaz; consulta solta faz autocommit', async () => {
    await tenant.withOrganization(ORG_A, async () => {
      const c = await tenant.connect();
      try {
        await c.query('begin');
        await c.query(`insert into crm_pipelines(organization_id, name, slug) values ($1, 'Tx', 'tx-rollback')`, [ORG_A]);
        await c.query('rollback');
        await c.query('BEGIN');
        await c.query(`insert into crm_pipelines(organization_id, name, slug) values ($1, 'Tx', 'tx-commit')`, [ORG_A]);
        await c.query('commit');
        await c.query(`insert into crm_pipelines(organization_id, name, slug) values ($1, 'Solta', 'solta')`, [ORG_A]);
      } finally {
        c.release();
      }
    });
    expect(await contagem(dono, `select count(*) n from crm_pipelines where organization_id = '${ORG_A}' and slug = 'tx-rollback'`)).toBe(0);
    expect(await contagem(dono, `select count(*) n from crm_pipelines where organization_id = '${ORG_A}' and slug in ('tx-commit','solta')`)).toBe(2);
  });

  it('cliente devolvido com transação aberta é revertido: sem vazamento para o próximo uso', async () => {
    await tenant1.withOrganization(ORG_A, async () => {
      const c = await tenant1.connect();
      await c.query('begin');
      await c.query(`insert into crm_pipelines(organization_id, name, slug) values ($1, 'Esquecida', 'esquecida')`, [ORG_A]);
      c.release(); // esqueceu o commit
    });
    expect(await contagem(dono, `select count(*) n from crm_pipelines where organization_id = '${ORG_A}' and slug = 'esquecida'`)).toBe(0);
    const { rows } = await app1.query<{ org: string | null }>(`select nullif(current_setting('app.worker_org', true), '') org`);
    expect(rows[0]!.org).toBeNull();
  });

  it('unidade atômica: erro desfaz tudo; begin/commit aninhados viram savepoints', async () => {
    await expect(
      tenant.withOrganizationTransaction(ORG_A, async (client) => {
        await client.query(`insert into crm_pipelines(organization_id, name, slug) values ($1, 'Atomica', 'atomica-1')`, [ORG_A]);
        throw new Error('falha no meio');
      }),
    ).rejects.toThrow('falha no meio');
    expect(await contagem(dono, `select count(*) n from crm_pipelines where organization_id = '${ORG_A}' and slug = 'atomica-1'`)).toBe(0);

    await tenant.withOrganizationTransaction(ORG_A, async () => {
      await tenant.query(`insert into crm_pipelines(organization_id, name, slug) values ($1, 'Externa', 'atomica-ext')`, [ORG_A]);
      const c = await tenant.connect(); // dentro da unidade: mesma conexão
      await c.query('begin');
      await c.query(`insert into crm_pipelines(organization_id, name, slug) values ($1, 'Interna', 'atomica-int')`, [ORG_A]);
      await c.query('rollback'); // só o savepoint
      c.release();
    });
    expect(await contagem(dono, `select count(*) n from crm_pipelines where organization_id = '${ORG_A}' and slug = 'atomica-ext'`)).toBe(1);
    expect(await contagem(dono, `select count(*) n from crm_pipelines where organization_id = '${ORG_A}' and slug = 'atomica-int'`)).toBe(0);
  });

  it('não aceita outra organização aninhada dentro do contexto', async () => {
    await tenant.withOrganization(ORG_A, async () => {
      expect(() => tenant.withOrganization(ORG_B, async () => undefined)).toThrow(TenantContextError);
      await expect(tenant.withOrganizationTransaction(ORG_B, async () => undefined)).rejects.toBeInstanceOf(TenantContextError);
    });
    expect(() => tenant.withOrganization('nao-e-uuid', async () => undefined)).toThrow(TenantContextError);
  });

  // ── Plano global ────────────────────────────────────────────────────────────────────────
  it('global: só ids e números; nada de tenant; playbook de plataforma legível', async () => {
    await tenant.withGlobal(async () => {
      const orgs = (await tenant.query<{ id: string }>('select fn_worker_orgs() id')).rows.map((r) => r.id).sort();
      expect(orgs).toEqual([ORG_A, ORG_B].sort()); // suspensa e sem cadastro ficam de fora
      const vencidos = (await tenant.query<{ id: string }>('select fn_worker_orgs_com_job_vencido() id')).rows.map((r) => r.id).sort();
      expect(vencidos).toEqual([ORG_A, ORG_B].sort());
      expect(Number((await tenant.query<{ n: number }>('select fn_worker_jobs_em_execucao() n')).rows[0]!.n)).toBe(0);
      expect((await tenant.query<{ ms: number | null }>('select fn_worker_ms_para_o_proximo_job() ms')).rows[0]!.ms).toBe(0);
      // nenhuma tabela de tenant aparece sem organização
      for (const t of ['crm_pipelines', 'contacts', 'job_queue', 'organizations']) {
        expect(await contagem(tenant, `select count(*) n from public.${t}`)).toBe(0);
      }
      // o conteúdo global estritamente necessário
      expect(await contagem(tenant, `select count(*) n from playbook_pointers where layer = 'platform' and organization_id is null`)).toBe(1);
      expect(await contagem(tenant, `select count(*) n from playbook_versions where organization_id is null and layer = 'platform'`)).toBe(1);
    });
  });

  it('global e org NÃO dão passe livre a tabelas de identidade, autorização ou credencial de usuário', async () => {
    await tenant.withOrganization(ORG_A, async () => {
      for (const t of ['user_organizations', 'neon_service_identities', 'api_tokens', 'team_invites']) {
        const r = await tenant.query(`select count(*)::int n from public.${t}`).catch((e: { code?: string }) => ({ rows: [{ n: `erro:${e.code}` }] }));
        expect([0, 'erro:42501']).toContain(r.rows[0]!.n);
      }
      await expect(
        tenant.query(`insert into user_organizations(user_id, organization_id, role) values ($1, $2, 'admin')`, [UID, ORG_A]),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('auditoria é append-only para o worker: insere e lê, não reescreve nem apaga', async () => {
    await tenant.withOrganization(ORG_A, async () => {
      await tenant.query(`insert into api_audit_log(organization_id, action) values ($1, 'teste.worker')`, [ORG_A]);
      expect(await contagem(tenant, `select count(*) n from api_audit_log where action = 'teste.worker'`)).toBe(1);
      expect((await tenant.query(`update api_audit_log set action = 'adulterada' where action = 'teste.worker'`)).rowCount).toBe(0);
      expect((await tenant.query(`delete from api_audit_log where action = 'teste.worker'`)).rowCount).toBe(0);
      await expect(tenant.query(`insert into api_audit_log(organization_id, action) values ($1, 'x')`, [ORG_B])).rejects.toMatchObject({ code: '42501' });
    });
    expect(await contagem(dono, `select count(*) n from api_audit_log where organization_id = '${ORG_A}' and action = 'teste.worker'`)).toBe(1);
  });

  // ── Não regride o acesso de usuário e fecha a superfície das funções ─────────────────────
  it('usuário humano (auth.uid) continua vendo só as organizações dele; fn_worker_org é nula para ele', async () => {
    const raw = await appBase.connect();
    try {
      await raw.query(`begin; select set_config('request.jwt.claim.sub','${USUARIO_HUMANO}',true)`);
      const orgs = (await raw.query<{ organization_id: string }>('select distinct organization_id from crm_pipelines')).rows.map((r) => r.organization_id);
      expect(orgs).toEqual([ORG_A]);
      expect((await raw.query('select public.fn_worker_org() o')).rows[0]).toEqual({ o: null });
      await raw.query('rollback');
    } finally {
      raw.release();
    }
  });

  it('fn_agent_worker_status: só a identidade de serviço (ou o worker) lê; usuário comum recebe NULL', async () => {
    // o worker, com o segredo do processo
    await tenant.withGlobal(async () => {
      const r = await tenant.query<{ s: { pendentes: number } | null }>('select public.fn_agent_worker_status() s');
      expect(r.rows[0]!.s).not.toBeNull();
    });
    // a identidade técnica do app (Data API: role authenticated + sub = usuário de serviço cadastrado)
    const c = await dono.connect();
    try {
      await c.query('begin');
      await c.query(`set local role authenticated`);
      await c.query(`select set_config('request.jwt.claim.sub', '${UID}', true)`);
      expect((await c.query('select public.fn_agent_worker_status() s')).rows[0].s).not.toBeNull();
      await c.query(`select set_config('request.jwt.claim.sub', '${USUARIO_HUMANO}', true)`);
      expect((await c.query('select public.fn_agent_worker_status() s')).rows[0].s).toBeNull();
      await c.query('rollback');
    } finally {
      c.release();
    }
  });

  it('as funções do worker não são executáveis por anon, authenticated nem service_role', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const c = await dono.connect();
      try {
        await c.query(`set role ${role}`);
        for (const fn of ['fn_worker_orgs()', 'fn_worker_org()', 'fn_worker_identity_ok()']) {
          await expect(c.query(`select public.${fn}`)).rejects.toMatchObject({ code: '42501' });
        }
      } finally {
        await c.query('reset role').catch(() => undefined);
        c.release();
      }
    }
  });
});
