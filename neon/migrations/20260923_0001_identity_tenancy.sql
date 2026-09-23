-- =============================================================================
-- Neon homologation core — identity + multi-tenant RLS
-- 2026-09-23
--
-- Native Neon replacement for the Supabase-specific identity boundary.
-- This migration intentionally covers only the platform tenancy core.
-- It does not create Supabase Storage/Realtime objects and does not touch production.
-- =============================================================================

begin;

create extension if not exists pgcrypto;
create extension if not exists citext;

create schema if not exists auth;

-- Compatibility helpers for the existing RLS vocabulary.
-- The trusted application server validates the Neon Auth JWT first and then
-- places the verified claims in request.jwt.claims for the database transaction.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select case
    when nullif(current_setting('request.jwt.claims', true), '') is null then '{}'::jsonb
    else current_setting('request.jwt.claims', true)::jsonb
  end
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  with claim as (
    select coalesce(
      nullif(auth.jwt()->>'sub', ''),
      nullif(current_setting('app.user_id', true), '')
    ) as value
  )
  select case
    when value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then value::uuid
    else null
  end
  from claim
$$;

comment on function auth.uid() is
  'Verified Neon Auth user id supplied by the trusted server transaction.';

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug citext not null unique,
  legal_name text not null,
  display_name text not null,
  cnpj text unique,
  status text not null default 'active'
    check (status in ('active','suspended','redacted','archived')),
  timezone text not null default 'America/Sao_Paulo',
  locale text not null default 'pt-BR',
  rate_limit_rps integer not null default 100,
  ai_budget_cents bigint,
  media_retention_days integer not null default 365,
  settings jsonb not null default '{}'::jsonb,
  dpo_email citext,
  privacy_policy_url text,
  onboarded_at timestamptz,
  suspended_at timestamptz,
  redacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references neon_auth."user"(id) on delete set null,
  onboarding_state jsonb not null default '{}'::jsonb,
  suspended_reason text,
  suspended_by uuid references neon_auth."user"(id) on delete set null
);

create table if not exists public.user_organizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references neon_auth."user"(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role text not null check (role in ('viewer','agent','manager','admin')),
  invited_by uuid references neon_auth."user"(id) on delete set null,
  invited_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, organization_id)
);

create index if not exists user_organizations_user_active_idx
  on public.user_organizations(user_id, organization_id)
  where revoked_at is null;

create index if not exists user_organizations_org_active_idx
  on public.user_organizations(organization_id, user_id)
  where revoked_at is null;

create or replace function public.fn_user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select organization_id
  from public.user_organizations
  where user_id = auth.uid()
    and revoked_at is null
$$;

create or replace function public.fn_user_role_in_org(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role
  from public.user_organizations
  where user_id = auth.uid()
    and organization_id = p_org
    and revoked_at is null
  limit 1
$$;

create or replace function public.fn_role_at_least(p_org uuid, p_min text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with levels(role, lvl) as (
    values ('viewer',1),('agent',2),('manager',3),('admin',4)
  )
  select coalesce(
    (
      select user_lvl.lvl >= min_lvl.lvl
      from levels user_lvl
      join levels min_lvl on min_lvl.role = p_min
      where user_lvl.role = public.fn_user_role_in_org(p_org)
    ),
    false
  )
$$;

alter table public.organizations enable row level security;
alter table public.user_organizations enable row level security;

do $policy$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='organizations'
      and policyname='neon_tenant_organizations_select'
  ) then
    create policy neon_tenant_organizations_select
      on public.organizations
      for select
      using (id in (select public.fn_user_org_ids()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='organizations'
      and policyname='neon_tenant_organizations_update'
  ) then
    create policy neon_tenant_organizations_update
      on public.organizations
      for update
      using (
        id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(id, 'admin')
      )
      with check (
        id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(id, 'admin')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='user_organizations'
      and policyname='neon_tenant_memberships_select'
  ) then
    create policy neon_tenant_memberships_select
      on public.user_organizations
      for select
      using (organization_id in (select public.fn_user_org_ids()));
  end if;
end
$policy$;

create table if not exists public.neon_schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now(),
  note text
);

insert into public.neon_schema_migrations(version, note)
values (
  '20260923_0001_identity_tenancy',
  'Neon Auth identity boundary + organizations/memberships RLS'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    note = excluded.note;

commit;
