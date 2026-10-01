-- Próximo responsável operacional para automações server-side.
-- Não abre crm_leads/crm_task_responsibles à role privada; a função resolve a
-- carga internamente e só pode ser executada pelas roles gravity_app_*.

begin;

create or replace function public.fn_task_responsible_next_for_org(p_org uuid)
returns table (
  id uuid,
  organization_id uuid,
  code text,
  name text,
  linked_user_id uuid,
  is_active boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if session_user !~ '^gravity_app_' then
    raise exception 'server role required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('crm_responsavel:' || p_org::text, 0));

  return query
  select r.id,r.organization_id,r.code,r.name,r.linked_user_id,r.is_active
    from public.crm_task_responsibles r
    left join public.crm_leads l
      on l.organization_id=r.organization_id
     and l.responsible_profile_id=r.id
     and l.status='open'
   where r.organization_id=p_org
     and r.is_active=true
   group by r.id,r.organization_id,r.code,r.name,r.linked_user_id,r.is_active
   order by count(l.id) asc,r.name asc
   limit 1;
end;
$$;

revoke all on function public.fn_task_responsible_next_for_org(uuid)
  from public,anon,authenticated,service_role;

do $grants$
declare r record;
begin
  for r in select rolname from pg_roles where rolname ~ '^gravity_app_'
  loop
    execute format(
      'grant execute on function public.fn_task_responsible_next_for_org(uuid) to %I',
      r.rolname
    );
  end loop;
end
$grants$;

commit;

insert into public.neon_schema_migrations(version,note)
values(
 '20260930_0025_proximo_responsavel_operacional',
 'Backend escolhe perfil operacional com menor carga de negocios abertos'
)
on conflict(version) do update
set applied_at=excluded.applied_at,note=excluded.note;
