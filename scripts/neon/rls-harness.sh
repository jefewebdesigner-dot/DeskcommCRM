#!/usr/bin/env bash
# Postgres descartável com o schema REAL do Neon e a role restrita de aplicação, para PROVAR
# isolamento por organização de verdade — sem tocar produção.
#
#   scripts/neon/rls-harness.sh up      sobe o container e carrega o schema
#   scripts/neon/rls-harness.sh url     imprime as URLs (dono e app) — só loopback
#   scripts/neon/rls-harness.sh down    derruba e apaga (tmpfs: nada sobra em disco)
#
# Fonte do schema (em ordem):
#   1. RLS_HARNESS_SCHEMA=/caminho/prod-schema.sql — dump `pg_dump --schema-only --no-owner` de
#      public/auth/neon_auth/extensions do banco real (é o que dá fidelidade: o Neon de produção
#      recebeu migrations que nunca voltaram para o repositório);
#   2. senão, neon/baseline.sql + neon/migrations/*.sql do repositório (aproximação).
#
# Requer Docker. O banco vive em tmpfs, escuta só em 127.0.0.1 e as senhas são aleatórias por subida.
# Não é para produção: imagem de teste (pgvector), sem digest fixado.
set -euo pipefail

NOME="${RLS_HARNESS_NOME:-gravity-rls-harness}"
PORTA="${RLS_HARNESS_PORTA:-55432}"
IMAGEM="${RLS_HARNESS_IMAGEM:-pgvector/pgvector:pg18}"
ROLE_APP="${RLS_HARNESS_ROLE_APP:-gravity_app_6f629e1848d4}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARQ_ESTADO="${TMPDIR:-/tmp}/${NOME}.env"

psql_dono() { docker exec -i "$NOME" psql -v ON_ERROR_STOP=1 -q -U neondb_owner -d neondb "$@"; }

subir() {
  docker rm -f "$NOME" >/dev/null 2>&1 || true
  local senha senha_app
  senha="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
  senha_app="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
  docker run -d --name "$NOME" -e POSTGRES_PASSWORD="$senha" -e POSTGRES_USER=neondb_owner -e POSTGRES_DB=neondb \
    -p "127.0.0.1:${PORTA}:5432" --tmpfs /var/lib/postgresql:rw,size=2g "$IMAGEM" >/dev/null
  for _ in $(seq 1 60); do
    docker exec "$NOME" pg_isready -U neondb_owner -d neondb >/dev/null 2>&1 && break
    sleep 1
  done
  # dono = superusuário do container (dono das tabelas, sem FORCE RLS — como o neondb_owner).
  # A role da aplicação NÃO é superusuária nem BYPASSRLS: é ela que se prova.
  psql_dono <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
  if not exists (select 1 from pg_roles where rolname='neon_superuser') then create role neon_superuser nologin; end if;
  if not exists (select 1 from pg_roles where rolname='cloud_admin') then create role cloud_admin nologin; end if;
end \$\$;
create role ${ROLE_APP} login password '${senha_app}' nosuperuser nobypassrls nocreatedb nocreaterole;
-- No Neon real estas extensões vivem em public (o schema referencia public.gen_random_bytes, public.vector...).
create extension if not exists pgcrypto with schema public;
create extension if not exists vector with schema public;
create extension if not exists citext with schema public;
create extension if not exists pg_trgm with schema public;
create schema if not exists extensions;
create extension if not exists "uuid-ossp" with schema extensions;
SQL
  if [[ -n "${RLS_HARNESS_SCHEMA:-}" && -f "${RLS_HARNESS_SCHEMA}" ]]; then
    # o dump cria `extensions`, que já existe (uuid-ossp): torna idempotente
    sed -E "s/^CREATE SCHEMA ([a-z_]+);/CREATE SCHEMA IF NOT EXISTS \1;/" "${RLS_HARNESS_SCHEMA}" | psql_dono >/dev/null
  else
    psql_dono <<SQL
create schema if not exists neon_auth;
create table neon_auth."user" (
  id uuid primary key default gen_random_uuid(), name text, email text unique,
  "emailVerified" boolean default false, image text, "createdAt" timestamptz default now(), "updatedAt" timestamptz default now(),
  role text, banned boolean, "banReason" text, "banExpires" timestamptz
);
create table neon_auth."session" (
  id uuid primary key default gen_random_uuid(), "userId" uuid references neon_auth."user"(id) on delete cascade,
  "expiresAt" timestamptz, token text, "createdAt" timestamptz default now(), "updatedAt" timestamptz default now()
);
alter default privileges for role neondb_owner in schema public grant select, insert, update, delete on tables to ${ROLE_APP};
alter default privileges for role neondb_owner in schema public grant usage, select, update on sequences to ${ROLE_APP};
grant usage on schema public to ${ROLE_APP};
SQL
    psql_dono < "$RAIZ/neon/baseline.sql" >/dev/null
    for f in $(ls "$RAIZ"/neon/migrations/*.sql | sort); do psql_dono < "$f" >/dev/null; done
  fi
  printf 'RLS_DB_DONO=postgres://neondb_owner:%s@127.0.0.1:%s/neondb\nRLS_DB_APP=postgres://%s:%s@127.0.0.1:%s/neondb\n' \
    "$senha" "$PORTA" "$ROLE_APP" "$senha_app" "$PORTA" > "$ARQ_ESTADO"
  chmod 600 "$ARQ_ESTADO"
  echo "harness no ar (URLs em $ARQ_ESTADO)"
}

case "${1:-}" in
  up) subir ;;
  url) cat "$ARQ_ESTADO" ;;
  down) docker rm -f "$NOME" >/dev/null 2>&1 || true; rm -f "$ARQ_ESTADO"; echo "harness removido" ;;
  *) echo "uso: $0 up|url|down" >&2; exit 2 ;;
esac
