-- =============================================================================
-- Neon Data API — grants mínimos para o núcleo multiempresa
-- 2026-09-23
--
-- A Data API autentica o JWT do Neon Auth e executa requests autenticadas sob
-- a role PostgreSQL `authenticated`. RLS continua sendo a autoridade por linha.
-- Nenhum BYPASSRLS, ownership ou privilégio DDL é concedido.
-- =============================================================================

begin;

do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated
      nologin
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls;
  end if;
end
$role$;

grant usage on schema public to authenticated;
grant usage on schema auth to authenticated;

grant execute on function auth.uid() to authenticated;
grant execute on function auth.jwt() to authenticated;
grant execute on function public.fn_user_org_ids() to authenticated;
grant execute on function public.fn_user_role_in_org(uuid) to authenticated;
grant execute on function public.fn_role_at_least(uuid, text) to authenticated;

grant select on public.organizations to authenticated;
grant select on public.user_organizations to authenticated;
grant update on public.organizations to authenticated;

insert into public.neon_schema_migrations(version, note)
values (
  '20260923_0003_data_api_grants',
  'Least-privilege grants for Neon Data API authenticated role'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    note = excluded.note;

commit;
