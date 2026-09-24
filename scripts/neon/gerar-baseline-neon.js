'use strict';

/**
 * Gera o baseline consolidado do DeskcommCRM para Neon.
 *
 * Mantém o baseline original como fonte de verdade e aplica apenas adaptações
 * de infraestrutura:
 * - owners/default privileges "postgres" -> role de migrations do Neon;
 * - FKs de auth.users -> neon_auth."user";
 * - auth.users/auth.sessions como views de leitura sobre Neon Auth;
 * - auth.mfa_factors vazio enquanto o plugin MFA não estiver habilitado;
 * - roles compatíveis anon/authenticated/service_role sem privilégio admin;
 * - stubs SQL de storage apenas para compatibilidade do schema legado.
 *
 * Nenhum segredo é escrito no SQL gerado.
 */

const fs = require('node:fs');
const path = require('node:path');

function argumento(nome, padrao = null) {
  const i = process.argv.indexOf('--' + nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

function ident(valor) {
  return '"' + String(valor).replace(/"/g, '""') + '"';
}

function roleDeMigration() {
  const explicita = argumento('owner');
  if (explicita) return explicita;

  const raw = process.env.MIGRATIONS_DATABASE_URL;
  if (!raw) {
    throw new Error('Informe --owner ou MIGRATIONS_DATABASE_URL');
  }
  const url = new URL(raw);
  const role = decodeURIComponent(url.username || '');
  if (!role) throw new Error('MIGRATIONS_DATABASE_URL sem usuário');
  return role;
}

function transformarFksDeUsuario(sql) {
  return sql
    .replace(
      /REFERENCES\s+"auth"\."users"\s*\(\s*"id"\s*\)/gi,
      'REFERENCES "neon_auth"."user"("id")',
    )
    .replace(
      /references\s+auth\.users\s*\(\s*id\s*\)/gi,
      'references neon_auth."user"(id)',
    );
}

function transformarCompatibilidadeExtensions(sql) {
  // No Neon, pgcrypto já vem instalado em public. O dump do Supabase referencia
  // a mesma função sob o schema extensions. Reescrevemos só esse símbolo;
  // uuid_generate_v4 continua em extensions, onde uuid-ossp é criado no prelude.
  return sql
    .replace(
      /"extensions"\."gen_random_bytes"/g,
      '"public"."gen_random_bytes"',
    )
    .replace(
      /\bextensions\.gen_random_bytes\b/g,
      'public.gen_random_bytes',
    );
}

function prelude(owner) {
  const qOwner = ident(owner);
  return String.raw`-- =============================================================================
-- DeskcommCRM — baseline de portabilidade Neon
-- Gerado automaticamente a partir de supabase/baseline.sql.
-- NÃO editar este arquivo gerado; altere o gerador ou o baseline de origem.
-- =============================================================================

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon
      nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated
      nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role
      nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$roles$;

create schema if not exists auth;
create schema if not exists extensions;
create schema if not exists storage;

create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema public;
create extension if not exists citext with schema public;
create extension if not exists pg_trgm with schema public;

-- Compatibilidade de identidade: os dados continuam pertencendo ao Neon Auth.
-- A view expõe apenas as colunas que o legado lê; nenhuma senha/token é exposta.
create or replace view auth.users as
select
  id,
  email,
  jsonb_build_object('full_name', name) as raw_user_meta_data,
  "createdAt" as created_at
from neon_auth."user";

create or replace view auth.sessions as
select
  id,
  "userId" as user_id,
  'aal1'::text as aal,
  "expiresAt" as not_after
from neon_auth."session";

-- MFA ainda não está habilitado no backend Neon desta instalação. Uma view
-- vazia mantém os checks conservadores: fluxos que exigem AAL2 continuam
-- bloqueados em vez de serem liberados sem prova.
create or replace view auth.mfa_factors as
select
  null::uuid as id,
  null::uuid as user_id,
  null::text as status,
  null::text as factor_type
where false;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb
$fn$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$fn$;

-- Metadados legados de buckets/policies permanecem em Postgres apenas para o
-- baseline convergir. O runtime de arquivos usa Neon Object Storage/S3.
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

grant usage on schema auth, extensions, storage to anon, authenticated, service_role;

-- Owner efetivo desta instalação Neon: ${qOwner}
`;
}

function main() {
  const root = path.resolve(__dirname, '..', '..');
  const entrada = path.resolve(
    argumento('input', path.join(root, 'supabase', 'baseline.sql')),
  );
  const saida = path.resolve(
    argumento('output', path.join(root, 'neon', 'baseline.sql')),
  );
  const owner = roleDeMigration();

  let sql = fs.readFileSync(entrada, 'utf8');
  sql = transformarFksDeUsuario(sql);
  sql = transformarCompatibilidadeExtensions(sql);

  // O dump original foi produzido pelo papel "postgres" do Supabase. No Neon,
  // ownership e ALTER DEFAULT PRIVILEGES pertencem ao usuário da conexão DDL.
  sql = sql.replace(/"postgres"/g, ident(owner));

  const finalSql = prelude(owner) + '\n\n' + sql;
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  fs.writeFileSync(saida, finalSql, 'utf8');

  const fksLegadas = (
    finalSql.match(
      /REFERENCES\s+(?:"auth"\."users"|auth\.users)\s*\(/gi,
    ) || []
  ).length;

  if (fksLegadas) {
    throw new Error(
      'Ainda restam ' + fksLegadas + ' FK(s) apontando para auth.users',
    );
  }

  console.log(JSON.stringify({
    ok: true,
    input: path.relative(root, entrada),
    output: path.relative(root, saida),
    ownerRewritten: true,
    authUserForeignKeysRewritten: true,
    pgcryptoSchemaRewritten: true,
    secretsPrinted: false,
  }));
}

main();
