/**
 * Pool do Postgres do agent-engine, sob demanda no processo Next.js (rotas
 * `/api/v1`). Sem pool global no import — mesma disciplina de
 * `workers/media-derive-worker.ts` (derivePool). DATABASE_URL ausente
 * lança na hora do request (rota converte pra 503), não na importação do
 * módulo.
 */
import type pg from 'pg';

import { createPool } from './pool';

let _pool: pg.Pool | null = null;

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function databaseUrl(): string {
  const url = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('DATABASE_URL ausente — rascunho da IA indisponível');
  return url;
}

export function getRequestPool(): pg.Pool {
  if (!_pool) _pool = createPool(databaseUrl());
  return _pool;
}

/**
 * Pool efêmero com o contexto de identidade do usuário já autenticado pelo app.
 *
 * O contrato do backend Neon usa `auth.uid()` -> `app.user_id` nas conexões
 * SQL confiáveis. O valor não vem do body: o chamador precisa passar o UUID que
 * acabou de ser validado pelo Neon Auth/requireRole.
 *
 * É um pool separado por requisição de prévia e DEVE ser encerrado pelo
 * chamador. Assim nenhuma conexão pode voltar ao pool global carregando a
 * identidade de outro usuário.
 */
export function createRequestPoolForUser(userId: string): pg.Pool {
  if (!UUID_RX.test(userId)) {
    throw new Error('user_id inválido para contexto SQL da prévia');
  }

  const scoped = new URL(databaseUrl());
  const currentOptions = scoped.searchParams.get('options')?.trim();
  const tenantOption = `-c app.user_id=${userId}`;
  scoped.searchParams.set(
    'options',
    currentOptions ? `${currentOptions} ${tenantOption}` : tenantOption,
  );

  return createPool(scoped.toString());
}
