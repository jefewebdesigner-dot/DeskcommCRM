/**
 * Pool com CONTEXTO DE ORGANIZAÇÃO por transação — o ponto único por onde o agent-worker fala com o
 * banco como identidade de serviço escopada (migration Neon 0015).
 *
 * ─── O problema ─────────────────────────────────────────────────────────────────────────────
 *
 * O worker conecta com a role restrita de aplicação, que não é usuária; a RLS de tenant devolve zero
 * linha para ela. A saída NÃO é dar bypass (BYPASSRLS, dono do banco, service role, membership em
 * todas as organizações). A saída é: a cada unidade de trabalho de UMA organização, a transação
 * declara `(identidade, segredo, organização)` com `set_config(..., true)` — transaction-local — e as
 * policies `worker_org_scope` só liberam linhas daquela organização.
 *
 * ─── Por que o contexto vai por INSTRUÇÃO e não por job inteiro ─────────────────────────────
 *
 * Um turno do agente NÃO cabe numa transação só: ele grava o `send_ledger` ANTES de mandar a
 * mensagem, chama o LLM (segundos) e o transporte, e o desenho de idempotência depende de o ledger
 * já estar commitado quando o processo morre entre o envio e o fim do turno. Uma transação por job
 * perderia esse commit no crash e reenviaria ao cliente. Então:
 *
 *   - `pool.query` avulso = UMA transação curta com contexto (autocommit preservado, como sempre);
 *   - `pool.connect()` = cliente que aplica o contexto no `BEGIN` que o código já emite, e envolve
 *     numa transação própria qualquer consulta fora de `BEGIN` (mesmo autocommit);
 *   - `withOrganizationTransaction(org, fn)` = a unidade ATÔMICA explícita: uma conexão, um BEGIN,
 *     tudo do tenant nela (inclusive `pool.query`/`pool.connect` feitos dentro, que são roteados para
 *     a MESMA conexão — begin/commit aninhados viram savepoints).
 *
 * ─── Fail-closed ────────────────────────────────────────────────────────────────────────────
 *
 * O contexto vive num AsyncLocalStorage, carrega só o id da organização (nunca uma conexão) e vem
 * do job persistido, nunca de texto da IA. Consulta FORA de qualquer contexto lança
 * `TenantContextError` em vez de devolver "zero linhas" em silêncio. O plano global (`withGlobal`)
 * declara só a identidade, sem organização: alcança as funções `fn_worker_*` (ids e números) e nada
 * de tenant.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import type pg from 'pg';

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** O segredo entra num literal SQL: só alfabeto seguro, e comprido o bastante para ser segredo. */
const SEGREDO_RX = /^[A-Za-z0-9_-]{24,200}$/;

export class TenantContextError extends Error {
  readonly code = 'tenant_context_required';
  constructor(message = 'consulta fora de contexto de organização') {
    super(message);
    this.name = 'TenantContextError';
  }
}

export interface WorkerIdentity {
  /** Usuário técnico cadastrado em `neon_service_identities` (uma linha por organização). */
  serviceUserId: string;
  /** Segredo do processo; o banco guarda só o hash (`secret_sha256`). Nunca vai para log. */
  secret: string;
}

interface Pinned {
  client: pg.PoolClient;
  savepoints: number;
}

type Scope =
  | { mode: 'org'; organizationId: string; pinned?: Pinned }
  | { mode: 'global' };

const scopeStorage = new AsyncLocalStorage<Scope>();

export interface TenantPool extends pg.Pool {
  /** Executa `fn` no contexto da organização: cada consulta é uma transação curta com contexto. */
  withOrganization<T>(organizationId: string, fn: () => Promise<T>): Promise<T>;
  /** Plano global: só funções `fn_worker_*` (ids/números). Nenhum dado de tenant é visível. */
  withGlobal<T>(fn: () => Promise<T>): Promise<T>;
  /** Unidade atômica do tenant numa conexão só. Tudo feito dentro (mesmo por `pool.query`) usa ela. */
  withOrganizationTransaction<T>(organizationId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T>;
  /** Pool cru — só para o encerramento e para testes; consulta por aqui NÃO tem contexto. */
  readonly base: pg.Pool;
}

function contextSql(identity: WorkerIdentity, organizationId: string | null): string {
  return (
    `select set_config('app.worker_uid','${identity.serviceUserId}',true),` +
    ` set_config('app.worker_secret','${identity.secret}',true),` +
    ` set_config('app.worker_org','${organizationId ?? ''}',true)`
  );
}

const BEGIN_RX = /^\s*(begin|start\s+transaction)\b/i;
const COMMIT_RX = /^\s*(commit|end)\b/i;
const ROLLBACK_RX = /^\s*(rollback|abort)\b(?!\s+(work\s+|transaction\s+)?to\b)/i;

function textOf(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg && typeof arg === 'object' && typeof (arg as { text?: unknown }).text === 'string') {
    return (arg as { text: string }).text;
  }
  return '';
}

export function createTenantPool(base: pg.Pool, identity: WorkerIdentity): TenantPool {
  if (!UUID_RX.test(identity.serviceUserId)) throw new Error('WORKER_SERVICE_USER_ID inválido (esperado UUID)');
  if (!SEGREDO_RX.test(identity.secret)) throw new Error('WORKER_DB_SECRET ausente ou fora do formato (>= 24 caracteres [A-Za-z0-9_-])');

  const beginWithContext = (organizationId: string | null): string =>
    `begin; ${contextSql(identity, organizationId)}`;
  const orgOf = (s: Scope): string | null => (s.mode === 'org' ? s.organizationId : null);

  /** Uma instrução = uma transação curta com contexto (autocommit preservado). */
  async function runStatement(raw: pg.PoolClient, s: Scope, args: unknown[]): Promise<unknown> {
    await raw.query(beginWithContext(orgOf(s)));
    try {
      const result = await (raw.query as (...a: unknown[]) => Promise<unknown>).apply(raw, args);
      await raw.query('commit');
      return result;
    } catch (err) {
      const rollbackOk = await raw.query('rollback').then(
        () => true,
        () => false,
      );
      // Se nem o ROLLBACK passou a conexão não é confiável: quem chama a descarta em vez de devolver ao pool.
      if (!rollbackOk && err && typeof err === 'object') {
        Object.defineProperty(err, 'tenantPoolConexaoQuebrada', { value: true });
      }
      throw err;
    }
  }

  const quebrada = (err: unknown): boolean =>
    Boolean(err && typeof err === 'object' && (err as { tenantPoolConexaoQuebrada?: boolean }).tenantPoolConexaoQuebrada);

  function requireScope(): Scope {
    const s = scopeStorage.getStore();
    if (!s) throw new TenantContextError();
    return s;
  }

  /** Cliente que aplica o contexto no BEGIN do chamador e envolve o que estiver fora de BEGIN. */
  function wrapClient(raw: pg.PoolClient, s: Scope, release: () => void): pg.PoolClient {
    let inTx = false;
    const rawQuery = raw.query.bind(raw) as (...a: unknown[]) => Promise<unknown>;
    const query = async (...args: unknown[]): Promise<unknown> => {
      if (typeof args[args.length - 1] === 'function') {
        throw new Error('tenant-pool: query com callback não é suportada — use promise');
      }
      const text = textOf(args[0]);
      if (BEGIN_RX.test(text)) {
        if (inTx) return rawQuery(...args); // begin dentro de begin: o Postgres avisa, como sempre
        inTx = true;
        try {
          await rawQuery(beginWithContext(orgOf(s)));
        } catch (err) {
          inTx = false;
          throw err;
        }
        return { command: 'BEGIN', rowCount: null, oid: 0, rows: [], fields: [] };
      }
      if (COMMIT_RX.test(text) || ROLLBACK_RX.test(text)) {
        inTx = false;
        return rawQuery(...args);
      }
      if (inTx) return rawQuery(...args);
      return runStatement(raw, s, args);
    };
    return new Proxy(raw, {
      get(target, prop) {
        if (prop === 'query') return query;
        if (prop === 'release') {
          return (err?: Error | boolean) => {
            if (inTx) {
              // Transação esquecida aberta: nada de contexto vazando para o próximo uso da conexão.
              inTx = false;
              void rawQuery('rollback').then(
                () => release(),
                () => target.release(true),
              );
              return;
            }
            if (err) target.release(err as Error);
            else release();
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  /** Cliente da unidade atômica: begin/commit/rollback do código viram savepoints. */
  function wrapPinned(pinned: Pinned): pg.PoolClient {
    const stack: number[] = [];
    const rawQuery = pinned.client.query.bind(pinned.client) as (...a: unknown[]) => Promise<unknown>;
    const query = async (...args: unknown[]): Promise<unknown> => {
      const text = textOf(args[0]);
      if (BEGIN_RX.test(text)) {
        const id = ++pinned.savepoints;
        stack.push(id);
        await rawQuery(`savepoint tp_${id}`);
        return { command: 'BEGIN', rowCount: null, oid: 0, rows: [], fields: [] };
      }
      if (COMMIT_RX.test(text)) {
        const id = stack.pop();
        if (id !== undefined) await rawQuery(`release savepoint tp_${id}`);
        return { command: 'COMMIT', rowCount: null, oid: 0, rows: [], fields: [] };
      }
      if (ROLLBACK_RX.test(text)) {
        const id = stack.pop();
        if (id !== undefined) {
          await rawQuery(`rollback to savepoint tp_${id}`);
          await rawQuery(`release savepoint tp_${id}`);
        }
        return { command: 'ROLLBACK', rowCount: null, oid: 0, rows: [], fields: [] };
      }
      return rawQuery(...args);
    };
    return new Proxy(pinned.client, {
      get(target, prop) {
        if (prop === 'query') return query;
        if (prop === 'release') return () => undefined; // a conexão é da unidade atômica
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  const overrides: Record<string, unknown> = {
    async query(...args: unknown[]): Promise<unknown> {
      if (typeof args[args.length - 1] === 'function') {
        throw new Error('tenant-pool: query com callback não é suportada — use promise');
      }
      const s = requireScope();
      if (s.mode === 'org' && s.pinned) {
        return (s.pinned.client.query as (...a: unknown[]) => Promise<unknown>).apply(s.pinned.client, args);
      }
      const raw = await base.connect();
      let broken = false;
      try {
        return await runStatement(raw, s, args);
      } catch (err) {
        broken = quebrada(err);
        throw err;
      } finally {
        raw.release(broken ? true : undefined);
      }
    },

    async connect(): Promise<pg.PoolClient> {
      const s = requireScope();
      if (s.mode === 'org' && s.pinned) return wrapPinned(s.pinned);
      const raw = await base.connect();
      return wrapClient(raw, s, () => raw.release());
    },

    withOrganization<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
      if (!UUID_RX.test(organizationId)) throw new TenantContextError('organization_id inválido para o contexto');
      const atual = scopeStorage.getStore();
      if (atual?.mode === 'org' && atual.organizationId !== organizationId) {
        throw new TenantContextError('contexto de organização aninhado com OUTRA organização');
      }
      if (atual?.mode === 'org') return fn(); // mesma organização: já está dentro
      return scopeStorage.run({ mode: 'org', organizationId }, fn);
    },

    withGlobal<T>(fn: () => Promise<T>): Promise<T> {
      if (scopeStorage.getStore()?.mode === 'org') {
        throw new TenantContextError('plano global dentro de contexto de organização');
      }
      return scopeStorage.run({ mode: 'global' }, fn);
    },

    async withOrganizationTransaction<T>(organizationId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
      if (!UUID_RX.test(organizationId)) throw new TenantContextError('organization_id inválido para o contexto');
      const atual = scopeStorage.getStore();
      if (atual?.mode === 'org' && atual.organizationId !== organizationId) {
        throw new TenantContextError('transação de organização aninhada com OUTRA organização');
      }
      if (atual?.mode === 'org' && atual.pinned) return fn(wrapPinned(atual.pinned)); // já dentro: savepoints
      const raw = await base.connect();
      let broken = false;
      try {
        await raw.query(beginWithContext(organizationId));
        const pinned: Pinned = { client: raw, savepoints: 0 };
        let result: T;
        try {
          result = await scopeStorage.run({ mode: 'org', organizationId, pinned }, () => fn(wrapPinned(pinned)));
        } catch (err) {
          await raw.query('rollback').catch(() => {
            broken = true;
          });
          throw err;
        }
        await raw.query('commit');
        return result;
      } finally {
        raw.release(broken ? true : undefined);
      }
    },

    get base(): pg.Pool {
      return base;
    },
  };

  return new Proxy(base, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in overrides) {
        const v = overrides[prop];
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(overrides) : v;
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as unknown as TenantPool;
}
