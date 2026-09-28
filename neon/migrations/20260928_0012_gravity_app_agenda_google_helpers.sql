-- Gravity app role: permite somente as duas funções seguras de leitura de ocupação Google.
-- As funções são SECURITY DEFINER, validam pertencimento à organização no corpo e
-- devolvem apenas ocupação/estado — nunca título, descrição ou participantes.

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
    execute format(
      'grant execute on function public.fn_agenda_ocupacao_google_do_dono(uuid, uuid, timestamptz, timestamptz) to %I',
      r.rolname
    );
    execute format(
      'grant execute on function public.fn_agenda_conexoes_google_do_dono(uuid, uuid) to %I',
      r.rolname
    );
  end loop;
end
$grant$;

insert into public.neon_schema_migrations(version, note)
values (
  '20260928_0012_gravity_app_agenda_google_helpers',
  'Gravity app role executa helpers seguros de ocupacao/conexoes Google usados pela Agenda'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    note = excluded.note;

commit;
