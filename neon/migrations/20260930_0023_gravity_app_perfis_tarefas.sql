begin;

create or replace function public.fn_task_responsibles_for_org(p_org uuid)
returns table (
  id uuid,
  organization_id uuid,
  code text,
  name text,
  linked_user_id uuid,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if session_user !~ '^gravity_app_' then
    raise exception 'server role required' using errcode = '42501';
  end if;

  return query
  select r.id, r.organization_id, r.code, r.name, r.linked_user_id, r.is_active
  from public.crm_task_responsibles r
  where r.organization_id = p_org
    and r.is_active = true
  order by r.name asc;
end;
$$;

create or replace function public.fn_task_responsible_exists(p_org uuid, p_profile uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if session_user !~ '^gravity_app_' then
    raise exception 'server role required' using errcode = '42501';
  end if;

  return exists (
    select 1
    from public.crm_task_responsibles r
    where r.organization_id = p_org
      and r.id = p_profile
      and r.is_active = true
  );
end;
$$;

revoke all on function public.fn_task_responsibles_for_org(uuid) from public, anon, authenticated;
revoke all on function public.fn_task_responsible_exists(uuid,uuid) from public, anon, authenticated;

do $grants$
declare r record;
begin
  for r in select rolname from pg_roles where rolname ~ '^gravity_app_'
  loop
    execute format('grant execute on function public.fn_task_responsibles_for_org(uuid) to %I', r.rolname);
    execute format('grant execute on function public.fn_task_responsible_exists(uuid,uuid) to %I', r.rolname);
  end loop;
end
$grants$;


insert into public.neon_schema_migrations(version, note)
values (
  '20260930_0023_gravity_app_perfis_tarefas',
  'Role privada do app lista e valida perfis operacionais de tarefas sem abrir a tabela sob RLS'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    note = excluded.note;

commit;
