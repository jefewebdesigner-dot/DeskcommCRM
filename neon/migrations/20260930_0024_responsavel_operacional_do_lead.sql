-- Responsável operacional do negócio, separado da identidade de login.
-- Necessário quando mais de uma pessoa compartilha a mesma conta de acesso.

begin;

alter table public.crm_leads
  add column if not exists responsible_profile_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_leads_responsible_profile_org_fk'
  ) then
    alter table public.crm_leads
      add constraint crm_leads_responsible_profile_org_fk
      foreign key (responsible_profile_id, organization_id)
      references public.crm_task_responsibles(id, organization_id)
      on delete set null;
  end if;
end
$$;

create index if not exists crm_leads_org_responsible_status_idx
  on public.crm_leads (organization_id, responsible_profile_id, status);

commit;

insert into public.neon_schema_migrations(version, note)
values (
  '20260930_0024_responsavel_operacional_do_lead',
  'Negocio ganha responsavel operacional independente do login compartilhado'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    note = excluded.note;
