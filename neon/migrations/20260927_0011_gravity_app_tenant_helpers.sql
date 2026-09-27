-- Gravity app role: somente helpers de autorização necessários para RLS.
-- A identidade vem de app.user_id, preenchida pelo servidor após validar Neon Auth.
-- Não concede tabelas, BYPASSRLS, service identity nem funções administrativas.

begin;

do $grant$
declare
  r record;
begin
  for r in
    select rolname
    from pg_roles
    where rolname like 'gravity_app_%'
  loop
    execute format('grant execute on function public.fn_user_org_ids() to %I', r.rolname);
    execute format('grant execute on function public.fn_user_role_in_org(uuid) to %I', r.rolname);
    execute format('grant execute on function public.fn_role_at_least(uuid,text) to %I', r.rolname);
    execute format('grant execute on function public.fn_is_platform_admin() to %I', r.rolname);
  end loop;
end
$grant$;

insert into public.neon_schema_migrations(version, note)
values (
  '20260927_0011_gravity_app_tenant_helpers',
  'Gravity app role executa apenas helpers RLS; identidade verificada entra via app.user_id'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    note = excluded.note;

commit;
