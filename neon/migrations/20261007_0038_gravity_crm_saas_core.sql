-- Gravity CRM — SaaS Core / Revenue OS / Customer Success
-- 2026-10-07
--
-- Núcleo genérico. Nada de PJe ou regra da PeríciaIA entra aqui.
-- Apps/SaaS conectam receita via API token e uso via Product Events.

begin;

create table if not exists public.revenue_source_baselines (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source text not null,
  baseline_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  primary key (organization_id, source)
);

create unique index if not exists contacts_id_org_unique
  on public.contacts (id, organization_id);

create table if not exists public.saas_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (contact_id, organization_id)
    references public.contacts(id, organization_id) on delete set null (contact_id)
);
create unique index if not exists saas_accounts_org_contact_unique
  on public.saas_accounts (organization_id, contact_id) where contact_id is not null;
create index if not exists saas_accounts_org_idx
  on public.saas_accounts (organization_id, updated_at desc);

create table if not exists public.saas_account_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  source text not null,
  external_customer_id text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, source, external_customer_id),
  foreign key (account_id, organization_id)
    references public.saas_accounts(id, organization_id) on delete cascade
);
create index if not exists saas_account_identities_account_idx
  on public.saas_account_identities (organization_id, account_id);

create table if not exists public.revenue_subscription_states (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid,
  source text not null,
  external_subscription_id text not null,
  external_customer_id text,
  status text not null check (status in ('active','past_due','canceling','canceled','unknown')),
  mrr_cents bigint not null default 0 check (mrr_cents >= 0),
  started_at timestamptz,
  ended_at timestamptz,
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  unique (organization_id, source, external_subscription_id),
  foreign key (account_id, organization_id)
    references public.saas_accounts(id, organization_id) on delete set null
);
create index if not exists revenue_subscription_states_org_status_idx
  on public.revenue_subscription_states (organization_id, status);
create index if not exists revenue_subscription_states_account_idx
  on public.revenue_subscription_states (organization_id, account_id)
  where account_id is not null;

create table if not exists public.revenue_mrr_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid,
  source text not null,
  external_subscription_id text not null,
  external_customer_id text,
  event_type text not null check (event_type in ('new','expansion','contraction','reactivation','churn')),
  effective_at timestamptz not null,
  delta_cents bigint not null check (delta_cents <> 0),
  previous_mrr_cents bigint not null default 0 check (previous_mrr_cents >= 0),
  current_mrr_cents bigint not null default 0 check (current_mrr_cents >= 0),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  foreign key (account_id, organization_id)
    references public.saas_accounts(id, organization_id) on delete set null
);
create index if not exists revenue_mrr_events_org_effective_idx
  on public.revenue_mrr_events (organization_id, effective_at desc);

create table if not exists public.revenue_monthly_snapshots (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date),
  opening_mrr_cents bigint,
  new_mrr_cents bigint not null default 0,
  expansion_mrr_cents bigint not null default 0,
  reactivation_mrr_cents bigint not null default 0,
  contraction_mrr_cents bigint not null default 0,
  churn_mrr_cents bigint not null default 0,
  closing_mrr_cents bigint not null default 0,
  active_customers integer not null default 0,
  churned_customers integer not null default 0,
  nrr_rate numeric(9,6),
  grr_rate numeric(9,6),
  history_complete boolean not null default false,
  calculated_at timestamptz not null default now(),
  primary key (organization_id, month)
);

create table if not exists public.product_health_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  recent_activity_days integer not null default 14 check (recent_activity_days between 1 and 90),
  high_risk_after_days integer not null default 30 check (high_risk_after_days between 2 and 365),
  tracked_event_names text[] not null default '{}',
  updated_by uuid references neon_auth."user"(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (high_risk_after_days > recent_activity_days)
);

create table if not exists public.product_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  source text not null,
  external_event_id text not null,
  event_name text not null check (event_name ~ '^[a-z][a-z0-9_]{1,99}$'),
  occurred_at timestamptz not null,
  properties jsonb not null default '{}'::jsonb,
  ingested_at timestamptz not null default now(),
  unique (organization_id, source, external_event_id),
  foreign key (account_id, organization_id)
    references public.saas_accounts(id, organization_id) on delete cascade
);
create index if not exists product_events_account_time_idx
  on public.product_events (organization_id, account_id, occurred_at desc);

create table if not exists public.product_usage_states (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  first_event_at timestamptz not null,
  last_event_at timestamptz not null,
  total_events bigint not null default 1 check (total_events >= 1),
  recent_events_30d bigint not null default 0 check (recent_events_30d >= 0),
  previous_events_30d bigint not null default 0 check (previous_events_30d >= 0),
  usage_window_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (organization_id, account_id),
  foreign key (account_id, organization_id)
    references public.saas_accounts(id, organization_id) on delete cascade
);
create index if not exists product_usage_states_recency_idx
  on public.product_usage_states (organization_id, last_event_at desc);

create table if not exists public.customer_action_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  action_type text not null check (action_type in ('recover_payment','prevent_churn','link_contact','review_reactivation')),
  priority text not null check (priority in ('critical','high','medium','low')),
  status text not null default 'open' check (status in ('open','done','dismissed')),
  title text not null,
  evidence jsonb not null default '{}'::jsonb,
  revenue_impact_cents bigint not null default 0 check (revenue_impact_cents >= 0),
  assigned_to uuid references neon_auth."user"(id) on delete set null,
  due_at timestamptz,
  idempotency_key text not null,
  resolution_outcome text check (resolution_outcome is null or resolution_outcome in ('success','unsuccessful','not_applicable')),
  recovered_revenue_cents bigint not null default 0 check (recovered_revenue_cents >= 0),
  resolution_note text,
  resolved_by uuid references neon_auth."user"(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  foreign key (account_id, organization_id)
    references public.saas_accounts(id, organization_id) on delete cascade
);
create index if not exists customer_action_items_org_queue_idx
  on public.customer_action_items (organization_id, status, priority, revenue_impact_cents desc);

alter table public.revenue_source_baselines enable row level security;
alter table public.saas_accounts enable row level security;
alter table public.saas_account_identities enable row level security;
alter table public.revenue_subscription_states enable row level security;
alter table public.revenue_mrr_events enable row level security;
alter table public.revenue_monthly_snapshots enable row level security;
alter table public.product_health_settings enable row level security;
alter table public.product_events enable row level security;
alter table public.product_usage_states enable row level security;
alter table public.customer_action_items enable row level security;

do $policies$
declare t text;
begin
  foreach t in array array[
    'revenue_source_baselines','saas_accounts','saas_account_identities',
    'revenue_subscription_states','revenue_mrr_events','revenue_monthly_snapshots',
    'product_health_settings','product_events','product_usage_states','customer_action_items'
  ] loop
    execute format('drop policy if exists gravity_crm_tenant_select on public.%I', t);
    execute format('drop policy if exists gravity_crm_tenant_write on public.%I', t);
    execute format(
      'create policy gravity_crm_tenant_select on public.%I for select using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin())',
      t
    );
    execute format(
      'create policy gravity_crm_tenant_write on public.%I for all using (public.fn_is_platform_admin() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, ''manager''))) with check (public.fn_is_platform_admin() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, ''manager'')))',
      t
    );
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end
$policies$;

drop trigger if exists trg_saas_accounts_updated_at on public.saas_accounts;
create trigger trg_saas_accounts_updated_at before update on public.saas_accounts
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_product_health_settings_updated_at on public.product_health_settings;
create trigger trg_product_health_settings_updated_at before update on public.product_health_settings
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_customer_action_items_updated_at on public.customer_action_items;
create trigger trg_customer_action_items_updated_at before update on public.customer_action_items
  for each row execute function public.fn_set_updated_at();

create or replace function public.fn_ingest_product_event(
  p_organization_id uuid, p_account_id uuid, p_source text,
  p_external_event_id text, p_event_name text, p_occurred_at timestamptz,
  p_properties jsonb default '{}'::jsonb
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_event_id uuid;
begin
  if not auth.is_server_service() then
    raise exception 'server_service_required' using errcode='42501';
  end if;

  if not exists (
    select 1 from public.saas_accounts
    where id=p_account_id and organization_id=p_organization_id
  ) then raise exception 'account_not_found' using errcode='P0002'; end if;

  insert into public.product_events
    (organization_id,account_id,source,external_event_id,event_name,occurred_at,properties)
  values
    (p_organization_id,p_account_id,p_source,p_external_event_id,p_event_name,p_occurred_at,coalesce(p_properties,'{}'::jsonb))
  on conflict (organization_id,source,external_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then return false; end if;

  insert into public.product_usage_states
    (organization_id,account_id,first_event_at,last_event_at,total_events)
  values (p_organization_id,p_account_id,p_occurred_at,p_occurred_at,1)
  on conflict (organization_id,account_id) do update set
    first_event_at=least(public.product_usage_states.first_event_at,excluded.first_event_at),
    last_event_at=greatest(public.product_usage_states.last_event_at,excluded.last_event_at),
    total_events=public.product_usage_states.total_events+1,
    updated_at=now();
  return true;
end;
$$;
revoke all on function public.fn_ingest_product_event(uuid,uuid,text,text,text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.fn_ingest_product_event(uuid,uuid,text,text,text,timestamptz,jsonb) to authenticated, service_role;

create or replace function public.fn_product_usage_windows(
  p_organization_id uuid, p_now timestamptz default now()
) returns table(account_id uuid,recent_events_30d bigint,previous_events_30d bigint)
language sql stable security definer set search_path = public, pg_temp
as $$
  select pe.account_id,
    count(*) filter(where pe.occurred_at >= p_now-interval '30 days' and pe.occurred_at <= p_now)::bigint,
    count(*) filter(where pe.occurred_at >= p_now-interval '60 days' and pe.occurred_at < p_now-interval '30 days')::bigint
  from public.product_events pe
  where pe.organization_id=p_organization_id
    and pe.occurred_at >= p_now-interval '60 days' and pe.occurred_at <= p_now
  group by pe.account_id
$$;
revoke all on function public.fn_product_usage_windows(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.fn_product_usage_windows(uuid,timestamptz) to service_role;

insert into public.neon_schema_migrations(version,note)
values ('20261007_0038_gravity_crm_saas_core','Gravity CRM: Revenue OS, Customer 360, product telemetry e Customer Success')
on conflict(version) do update set applied_at=excluded.applied_at,note=excluded.note;

notify pgrst, 'reload schema';
commit;
