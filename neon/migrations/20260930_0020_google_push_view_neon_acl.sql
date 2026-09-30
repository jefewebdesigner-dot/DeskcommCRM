-- Neon — o cron de publicação Google usa o Data API com a identidade técnica,
-- cujo JWT chega como role authenticated.
--
-- A view é security_invoker=true: ao conceder SELECT para authenticated ela
-- NÃO ganha bypass. A RLS da calendar_appointments continua sendo aplicada.
-- A identidade técnica possui a policy service_identity_bypass; usuários comuns
-- continuam limitados por fn_user_org_ids()/papel. anon permanece sem acesso.

begin;

revoke all on public.calendar_google_reconcilable_appointments from anon;
grant select on public.calendar_google_reconcilable_appointments to authenticated, service_role;

insert into public.neon_schema_migrations(version, note)
values (
  '20260930_0020_google_push_view_neon_acl',
  'Data API tecnico pode ler view security_invoker do push Google; RLS da tabela base continua valendo'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    note = excluded.note;

commit;
