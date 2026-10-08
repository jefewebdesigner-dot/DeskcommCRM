-- Gravity CRM — Vertical Packs / PeríciaIA fusion marker
-- 2026-10-07
--
-- This migration DOES NOT create a second PeríciaIA organization and DOES NOT
-- copy contacts, leads, conversations or billing data. It marks the existing
-- organization as the first vertical tenant of Gravity CRM so the transition
-- can happen in place.
begin;

create table if not exists public.organization_vertical_packs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pack_id text not null check (pack_id ~ '^[a-z][a-z0-9_-]{1,63}$'),
  status text not null default 'active'
    check (status in ('transitioning','active','disabled')),
  config jsonb not null default '{}'::jsonb,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, pack_id)
);

create index if not exists organization_vertical_packs_org_idx
  on public.organization_vertical_packs (organization_id, status);

alter table public.organization_vertical_packs enable row level security;

drop policy if exists vertical_packs_select on public.organization_vertical_packs;
create policy vertical_packs_select
  on public.organization_vertical_packs
  for select
  using (
    organization_id in (select public.fn_user_org_ids())
    or public.fn_is_platform_admin()
  );

drop policy if exists vertical_packs_write on public.organization_vertical_packs;
create policy vertical_packs_write
  on public.organization_vertical_packs
  for all
  using (
    public.fn_is_platform_admin()
    or (
      organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
    )
  )
  with check (
    public.fn_is_platform_admin()
    or (
      organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
    )
  );

revoke all on public.organization_vertical_packs from anon;
grant select,insert,update,delete on public.organization_vertical_packs to authenticated;
grant all on public.organization_vertical_packs to service_role;

drop trigger if exists trg_organization_vertical_packs_updated_at on public.organization_vertical_packs;
create trigger trg_organization_vertical_packs_updated_at
before update on public.organization_vertical_packs
for each row execute function public.fn_set_updated_at();

-- Existing PeríciaIA organization. The id is already the source of truth in the
-- current billing sync. Mark it in place; never create a replacement tenant.
insert into public.organization_vertical_packs (
  organization_id,
  pack_id,
  status,
  config,
  activated_at
)
select
  id,
  'periciaia',
  'transitioning',
  jsonb_build_object(
    'fusion_strategy','in_place',
    'preserve_existing_organization',true,
    'preserve_contact_ids',true,
    'preserve_crm_history',true,
    'preserve_channel_sessions',true,
    'preserve_memberships',true,
    'legacy_backend_bridge','temporary',
    'pje_scope','platform_global'
  ),
  null
from public.organizations
where id='9563e071-406b-4db2-aaa4-d08846d3267b'::uuid
on conflict (organization_id, pack_id) do update
set
  status=case
    when public.organization_vertical_packs.status='active' then 'active'
    else 'transitioning'
  end,
  config=public.organization_vertical_packs.config || excluded.config;

insert into public.neon_schema_migrations(version,note)
values(
  '20261007_0040_vertical_packs',
  'Gravity CRM: first-class vertical packs and in-place PeríciaIA fusion marker'
)
on conflict(version) do update
set applied_at=excluded.applied_at,note=excluded.note;

notify pgrst,'reload schema';
commit;
