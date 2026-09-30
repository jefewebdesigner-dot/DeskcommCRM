-- Perfis operacionais de tarefas.
-- Se duas pessoas compartilham o mesmo login, a autenticação continua única,
-- mas o trabalho fica separado por perfil operacional da organização.

begin;

create table if not exists public.crm_task_responsibles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  linked_user_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_task_responsibles_code_nonempty check (length(btrim(code)) > 0),
  constraint crm_task_responsibles_name_nonempty check (length(btrim(name)) > 0),
  constraint crm_task_responsibles_org_code_unique unique (organization_id, code),
  constraint crm_task_responsibles_id_org_unique unique (id, organization_id)
);

create index if not exists crm_task_responsibles_org_active_idx
  on public.crm_task_responsibles (organization_id, is_active, name);

alter table public.crm_task_responsibles enable row level security;

drop policy if exists crm_task_responsibles_select on public.crm_task_responsibles;
create policy crm_task_responsibles_select on public.crm_task_responsibles
  for select using (
    organization_id in (select public.fn_user_org_ids())
    or public.fn_is_platform_admin()
  );

drop policy if exists crm_task_responsibles_write on public.crm_task_responsibles;
create policy crm_task_responsibles_write on public.crm_task_responsibles
  using (
    public.fn_is_platform_admin()
    or (
      organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager')
    )
  )
  with check (
    public.fn_is_platform_admin()
    or (
      organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager')
    )
  );

revoke all on public.crm_task_responsibles from anon;
grant select on public.crm_task_responsibles to authenticated;
grant all on public.crm_task_responsibles to service_role;

drop trigger if exists trg_crm_task_responsibles_updated_at on public.crm_task_responsibles;
create trigger trg_crm_task_responsibles_updated_at
  before update on public.crm_task_responsibles
  for each row execute function public.fn_set_updated_at();

alter table public.crm_tasks
  add column if not exists responsible_profile_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'crm_tasks_responsible_profile_org_fk'
  ) then
    alter table public.crm_tasks
      add constraint crm_tasks_responsible_profile_org_fk
      foreign key (responsible_profile_id, organization_id)
      references public.crm_task_responsibles(id, organization_id)
      on delete set null;
  end if;
end
$$;

create index if not exists crm_tasks_org_responsible_due_idx
  on public.crm_tasks (organization_id, responsible_profile_id, due_date);

commit;


-- Backend privado: leitura estreita sob RLS, sem abrir a tabela para o Data API.
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
