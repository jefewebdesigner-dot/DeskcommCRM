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
 * O schema Neon atual resolve `auth.uid()` pelo claim
 * `request.jwt.claim.sub`. O valor não vem do body: o chamador precisa passar
 * o UUID que acabou de ser validado pelo Neon Auth/requireRole.
 *
 * A prévia usa conexão direta (não pooler), pois o pooler do Neon rejeita
 * parâmetros customizados no startup package. O contexto é aplicado no evento
 * `connect` de cada conexão e o pool inteiro é encerrado ao fim da requisição,
 * impedindo reutilização da identidade entre usuários.
 */
export function createRequestPoolForUser(userId: string): pg.Pool {
  if (!UUID_RX.test(userId)) {
    throw new Error('user_id inválido para contexto SQL da prévia');
  }

  const direct = new URL(databaseUrl());
  direct.hostname = direct.hostname.replace('-pooler.', '.');
  const pool = createPool(direct.toString());

  pool.on('connect', (client) => {
    void client
      .query("select set_config('request.jwt.claim.sub', $1, false)", [userId])
      .catch(() => client.release(true));
  });

  return pool;
}
