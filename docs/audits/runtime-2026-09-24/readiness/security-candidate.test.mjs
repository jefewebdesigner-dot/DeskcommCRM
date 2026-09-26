import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const candidate = readFileSync(new URL('./0004-safe-candidate.sql', import.meta.url), 'utf8');
const blocked = readFileSync(new URL('../../../../neon/migrations/20260923_0004_server_service_identity.sql', import.meta.url), 'utf8');
const sqlOnly = (sql) => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

// Guarda de artefato textual, NÃO prova de execução SQL, RLS ou privilégio efetivo.
function assertNoExpandedAuthority(sql) {
  const executable = sqlOnly(sql);
  assert.doesNotMatch(executable, /\bgrant\b/i, 'nenhuma ampliação de ACL autorizada');
  assert.doesNotMatch(executable, /\bcreate\s+policy\b/i, 'nenhuma policy de bypass autorizada');
  assert.doesNotMatch(executable, /\bcreate\s+(or\s+replace\s+)?function\b/i, 'nenhum helper privilegiado autorizado');
  assert.doesNotMatch(executable, /\b(disable\s+row\s+level\s+security|bypassrls|alter\s+default\s+privileges)\b/i);
}

test('candidata não amplia autoridade nem cria bypass', () => assertNoExpandedAuthority(candidate));
test('guarda rejeita a migration bloqueada original (controle negativo)', () => {
  assert.throws(() => assertNoExpandedAuthority(blocked));
});
test('guarda rejeita cada mutação independente de privilégio', () => {
  for (const mutation of [
    'grant update on public.api_audit_log to authenticated;',
    'grant execute on all functions in schema public to authenticated;',
    'create policy bypass on public.contacts using (true);',
    'create function auth.is_server_service() returns boolean language sql as $$select true$$;',
    'alter table public.contacts disable row level security;',
  ]) assert.throws(() => assertNoExpandedAuthority(candidate + '\n' + mutation));
});
test('cadastro exige organização, RLS e nenhuma identidade ativa por padrão', () => {
  const sql = sqlOnly(candidate);
  assert.match(sql, /organization_id uuid not null references public\.organizations\(id\)/i);
  assert.match(sql, /primary key \(user_id, organization_id\)/i);
  assert.match(sql, /active boolean not null default false/i);
  assert.match(sql, /alter table public\.neon_service_identities enable row level security/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.neon_service_identities/i);
});
test('ACL é revogada nominalmente, incluindo PUBLIC e service_role; ACL desconhecida falha', () => {
  assert.match(sqlOnly(candidate), /revoke all privileges on table public\.neon_service_identities\s+from public, anon, authenticated, service_role;/i);
  assert.match(candidate, /aclexplode/);
  assert.match(candidate, /a\.grantee <> c\.relowner/);
  assert.match(candidate, /raise exception 'ACL inesperada/);
});
test('preflight recusa versão aplicada ou resíduos antes de criar qualquer tabela', () => {
  const sql = sqlOnly(candidate);
  const create = sql.indexOf('create table public.neon_service_identities');
  assert.ok(create > 0);
  for (const guard of [
    "where version = '20260923_0004_server_service_identity'",
    "to_regclass('public.neon_service_identities')",
    "to_regprocedure('auth.is_server_service()')",
    "policyname = 'neon_server_service_all'",
    "raise exception '0004 ja registrada",
    "raise exception 'Residuos da 0004",
  ]) assert.ok(sql.indexOf(guard) >= 0 && sql.indexOf(guard) < create, guard);
});
