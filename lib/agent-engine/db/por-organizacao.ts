/**
 * Plano GLOBAL do worker: como os laços que hoje varrem o banco inteiro passam a varrer UMA
 * ORGANIZAÇÃO de cada vez, sem nunca ler dado de tenant fora do contexto dela.
 *
 * O worker enxerga o mundo em dois planos (ver `tenant-pool.ts`):
 *   - global: só as funções `fn_worker_*`, que devolvem ids e números (quais organizações o worker
 *     atende, quais têm job vencido, quantos jobs rodando);
 *   - organização: tudo o mais, dentro do contexto transaction-local da organização.
 *
 * Os laços de manutenção (drain, watchdog, saúde do número, cron de follow-up, holds, reaper)
 * mantêm o corpo que já tinham — consultas sem filtro de organização — e passam a ser chamados
 * uma vez por organização, dentro do contexto dela: a RLS é quem restringe a consulta.
 *
 * Com um `pg.Pool` comum (testes de unidade, scripts) o helper chama `fn` uma vez, sem contexto:
 * o comportamento de antes, sem exigir banco com a migration do worker.
 */
import type pg from 'pg';

import type { Logger } from '../obs/logger';
import type { TenantPool } from './tenant-pool';

export function ehTenantPool(pool: pg.Pool): pool is TenantPool {
  return typeof (pool as Partial<TenantPool>).withOrganization === 'function';
}

async function globalRows<T extends pg.QueryResultRow>(pool: TenantPool, sql: string): Promise<T[]> {
  return pool.withGlobal(async () => (await pool.query<T>(sql)).rows);
}

/** Organizações que a identidade do worker atende (cadastro ativo + organização ativa). */
export async function organizacoesDoWorker(pool: TenantPool): Promise<string[]> {
  const rows = await globalRows<{ id: string }>(pool, 'select public.fn_worker_orgs() as id');
  return rows.map((r) => r.id);
}

/** Organizações com job `pending` já vencido — só ids, para o claim saber onde entrar. */
export async function organizacoesComJobVencido(pool: TenantPool): Promise<string[]> {
  const rows = await globalRows<{ id: string }>(pool, 'select public.fn_worker_orgs_com_job_vencido() as id');
  return rows.map((r) => r.id);
}

/** Jobs `running` em todas as organizações do worker (o cap de concorrência é GLOBAL). */
export async function jobsEmExecucao(pool: TenantPool): Promise<number> {
  const rows = await globalRows<{ n: number }>(pool, 'select public.fn_worker_jobs_em_execucao() as n');
  return Number(rows[0]?.n ?? 0);
}

/** Ms até o próximo job pending ficar claimável, `null` se não há (mesma conta de `faltaParaOProximoJob`). */
export async function msParaOProximoJob(pool: TenantPool): Promise<number | null> {
  const rows = await globalRows<{ ms: number | null }>(pool, 'select public.fn_worker_ms_para_o_proximo_job() as ms');
  const ms = rows[0]?.ms;
  return ms === null || ms === undefined ? null : Number(ms);
}

/** Contagem da fila por status — só números, para o /healthz. */
export async function filaPorStatus(pool: TenantPool): Promise<Record<string, number>> {
  const rows = await globalRows<{ status: string; n: number }>(pool, 'select status, n from public.fn_worker_fila_por_status()');
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

/**
 * Executa `fn` uma vez por organização, dentro do contexto dela. Falha numa organização é logada e
 * NÃO impede as demais (o mesmo contrato dos laços por sessão). Devolve os resultados que deram certo.
 */
export async function emCadaOrganizacao<T>(
  pool: pg.Pool,
  log: Logger | undefined,
  fn: (organizationId: string | null) => Promise<T>,
): Promise<T[]> {
  if (!ehTenantPool(pool)) return [await fn(null)];
  const resultados: T[] = [];
  const orgs = await organizacoesDoWorker(pool);
  for (const org of orgs) {
    try {
      resultados.push(await pool.withOrganization(org, () => fn(org)));
    } catch (err) {
      log?.error('worker: tarefa da organização falhou — segue as demais', {
        organization_id: org,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      });
    }
  }
  return resultados;
}

/** Soma resultados numéricos de `emCadaOrganizacao`. */
export async function somaPorOrganizacao(
  pool: pg.Pool,
  log: Logger | undefined,
  fn: (organizationId: string | null) => Promise<number>,
): Promise<number> {
  return (await emCadaOrganizacao(pool, log, fn)).reduce((a, b) => a + b, 0);
}

/** Soma campo a campo objetos de contagem (resultado de tick por organização). */
export function somarContagens<T extends Record<string, number>>(lista: T[], zero: T): T {
  const total: Record<string, number> = { ...zero };
  for (const item of lista) for (const [k, v] of Object.entries(item)) total[k] = (total[k] ?? 0) + v;
  return total as T;
}
