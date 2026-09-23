-- Neon homologation compatibility grants for the restricted Gravity app role.
begin;

revoke all on function auth.uid() from public;
revoke all on function auth.jwt() from public;

do $grant$
declare
  r record;
begin
  for r in
    select rolname
    from pg_roles
    where rolname like 'gravity_app_%'
  loop
    execute format('grant usage on schema auth to %I', r.rolname);
    execute format('grant execute on function auth.uid() to %I', r.rolname);
    execute format('grant execute on function auth.jwt() to %I', r.rolname);
  end loop;
end
$grant$;

insert into public.neon_schema_migrations(version, note)
values (
  '20260923_0002_auth_compat_grants',
  'Restrict auth compatibility helper access to Gravity application roles'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    note = excluded.note;

commit;
