-- PREPARADO; NÃO APLICADO. Candidato conservador, não habilita o runtime admin.
-- Substitui SOMENTE a 0004 comprovadamente nunca aplicada. Executar futuramente
-- em transação única pelo runner, após aprovação; nunca com credencial runtime.
-- A existência de cadastro NÃO concede autorização. Sem helper de bypass,
-- sem policy permissiva, sem GRANT de tabela/função, sem dados de identidade.

do $preflight$
begin
  if current_user in ('anon', 'authenticated', 'service_role')
     or current_user like 'gravity_app_%' then
    raise exception 'A candidata exige executor DDL separado do runtime';
  end if;
  if exists (
    select 1 from public.neon_schema_migrations
    where version = '20260923_0004_server_service_identity'
  ) then
    raise exception '0004 ja registrada: revisar ACLs e preparar forward-fix; nao reaplicar';
  end if;
  if to_regclass('public.neon_service_identities') is not null
     or to_regprocedure('auth.is_server_service()') is not null
     or exists (select 1 from pg_policies where policyname = 'neon_server_service_all') then
    raise exception 'Residuos da 0004: estado desconhecido; exigir auditoria antes de alterar';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'Papeis esperados ausentes; reconciliar baseline antes da candidata';
  end if;
end
$preflight$;

-- Reserva declarativa para identidade técnica por organização. Nenhum fluxo
-- consome este cadastro para contornar RLS. Nenhum usuário é cadastrado aqui.
create table public.neon_service_identities (
  user_id uuid not null references neon_auth."user"(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null default 'server' check (kind = 'server'),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, organization_id)
);

alter table public.neon_service_identities enable row level security;

-- Remove também ACLs herdadas do default ACL na criação. PUBLIC é um grant
-- independente das roles explícitas; service_role não administra este registro.
revoke all privileges on table public.neon_service_identities
  from public, anon, authenticated, service_role;

-- Varredura dinâmica: revoga de QUALQUER grantee que não seja o dono, sem
-- precisar nomear a role. Medido nesta instalação: `ALTER DEFAULT PRIVILEGES`
-- de neondb_owner concede arwd em toda tabela nova a um papel de
-- infraestrutura do Gravity (gravity_app_<hash>), fora do modelo de
-- autorização do CRM — não listar nomes fixos porque esse hash muda por
-- instalação e pode haver outras roles herdadas que ninguém documentou.
do $sweep_unexpected_acl$
declare
  r record;
begin
  for r in
    select a.grantee::regrole::text as grantee_name
    from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.neon_service_identities'::regclass
      and a.grantee <> c.relowner
      and a.grantee <> 0 -- 0 = PUBLIC, já coberto pelo REVOKE acima
  loop
    execute format('revoke all privileges on table public.neon_service_identities from %I', r.grantee_name);
  end loop;
end
$sweep_unexpected_acl$;

-- Defesa em profundidade: mesmo após a varredura, não aceitar privilégio
-- residual de origem não identificada (ex.: ACL calculada de forma diferente
-- pelo Postgres). Falha fecha a transação em vez de seguir com estado incerto.
do $verify_acl$
begin
  if exists (
    select 1
    from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.neon_service_identities'::regclass
      and a.grantee <> c.relowner
  ) then
    raise exception 'ACL inesperada no cadastro tecnico: interromper e revisar';
  end if;
end
$verify_acl$;

insert into public.neon_schema_migrations(version, note)
values (
  '20260923_0004_server_service_identity',
  'Cadastro tecnico por organizacao fechado por RLS/ACL; sem autorizacao admin ou bypass'
);
