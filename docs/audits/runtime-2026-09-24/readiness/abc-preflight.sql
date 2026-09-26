-- Read-only inventory, external disposable target only. No grants or fixture creation.
-- Supply psql variables user_a/user_b/user_c/org_a/org_b (UUIDs, never tokens).
\set ON_ERROR_STOP on
begin read only;
select current_database() as target_database, current_user as inspecting_role;
with actors(label, user_id, expected_org) as (
  values ('A', :'user_a'::uuid, :'org_a'::uuid),
         ('B', :'user_b'::uuid, :'org_b'::uuid),
         ('C', :'user_c'::uuid, null::uuid)
)
select a.label,
       exists(select 1 from neon_auth."user" u where u.id=a.user_id) as auth_user_exists,
       (select count(*) from public.user_organizations m
        where m.user_id=a.user_id and m.revoked_at is null) as active_memberships,
       (select count(*) from public.user_organizations m
        where m.user_id=a.user_id and m.revoked_at is null
          and m.organization_id=a.expected_org and m.role='admin') as expected_admin_membership,
       exists(select 1 from public.platform_admins p where p.user_id=a.user_id) as platform_admin
from actors a order by label;
select c.relname, c.relrowsecurity, c.relforcerowsecurity,
       has_table_privilege('authenticated', c.oid, 'SELECT') as can_select,
       has_table_privilege('authenticated', c.oid, 'INSERT') as can_insert,
       has_table_privilege('authenticated', c.oid, 'UPDATE') as can_update,
       has_table_privilege('authenticated', c.oid, 'DELETE') as can_delete
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in
  ('contacts','user_organizations','platform_admins','neon_service_identities','api_audit_log');
select rolname, rolsuper, rolbypassrls from pg_roles where rolname='authenticated';
select tablename, policyname, roles, cmd, qual, with_check from pg_policies
where schemaname='public' and tablename in ('contacts','user_organizations');
-- Optional table in the blocked proposal: inspect it only if present.
select format(
  'select count(*) as forbidden_fixture_service_identities from public.neon_service_identities where user_id in (%L::uuid,%L::uuid,%L::uuid);',
  :'user_a', :'user_b', :'user_c')
where to_regclass('public.neon_service_identities') is not null
\gexec
rollback;
