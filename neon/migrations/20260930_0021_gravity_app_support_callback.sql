-- Neon — callback OAuth precisa consultar a guarda de suporte pela role privada do app.
--
-- O Data API técnico chega como authenticated e não deve ganhar esta RPC.
-- O fallback server-side usa DATABASE_URL (gravity_app_*), então concedemos
-- EXECUTE somente às roles privadas da aplicação. Idempotente.

begin;

do $grants$
declare r record;
begin
  for r in
    select rolname
    from pg_roles
    where rolname like 'gravity_app\_%'
  loop
    execute format(
      'grant execute on function public.fn_support_callback_write_allowed(uuid, uuid, uuid) to %I',
      r.rolname
    );
  end loop;
end
$grants$;

insert into public.neon_schema_migrations(version, note)
values (
  '20260930_0021_gravity_app_support_callback',
  'Role privada gravity_app executa guarda de callback OAuth sem abrir a RPC para authenticated'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    note = excluded.note;

commit;
