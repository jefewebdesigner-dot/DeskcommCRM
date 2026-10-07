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
  baseline_completed_at timestamptz,
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

create or replace function public.fn_reconcile_saas_contact_identity(
  p_organization_id uuid,
  p_contact_id uuid,
  p_source text,
  p_external_customer_id text,
  p_display_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contact_account uuid;
  v_identity_account uuid;
  v_identity_contact uuid;
  v_account_id uuid;
  v_account_created boolean := false;
  v_identity_created boolean := false;
  v_contact_linked boolean := false;
begin
  if not auth.is_server_service()
     and coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'server_service_required' using errcode='42501';
  end if;

  if p_source !~ '^[a-z][a-z0-9_-]{1,49}$'
     or nullif(trim(p_external_customer_id),'') is null then
    raise exception 'invalid_customer_identity' using errcode='22023';
  end if;

  if not exists(
    select 1 from public.contacts
    where id=p_contact_id and organization_id=p_organization_id
  ) then
    raise exception 'contact_not_found' using errcode='P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_organization_id::text || ':contact:' || p_contact_id::text,
      0
    )
  );
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_organization_id::text || ':' || p_source || ':' || p_external_customer_id,
      0
    )
  );

  select a.id into v_contact_account
  from public.saas_accounts a
  where a.organization_id=p_organization_id
    and a.contact_id=p_contact_id
  limit 1;

  select i.account_id into v_identity_account
  from public.saas_account_identities i
  where i.organization_id=p_organization_id
    and i.source=p_source
    and i.external_customer_id=p_external_customer_id
  limit 1;

  if v_identity_account is not null then
    select a.contact_id into v_identity_contact
    from public.saas_accounts a
    where a.organization_id=p_organization_id
      and a.id=v_identity_account;
    if not found then
      raise exception 'identity_account_not_found' using errcode='P0002';
    end if;
  end if;

  if v_contact_account is not null
     and v_identity_account is not null
     and v_contact_account <> v_identity_account then
    raise exception 'saas_identity_contact_conflict' using errcode='23505';
  end if;

  if v_contact_account is not null then
    v_account_id := v_contact_account;
  elsif v_identity_account is not null then
    if v_identity_contact is not null and v_identity_contact <> p_contact_id then
      raise exception 'saas_identity_contact_conflict' using errcode='23505';
    end if;
    v_account_id := v_identity_account;
    if v_identity_contact is null then
      update public.saas_accounts
      set contact_id=p_contact_id,
          display_name=coalesce(nullif(trim(p_display_name),''),display_name)
      where id=v_account_id and organization_id=p_organization_id;
      v_contact_linked := true;
    end if;
  else
    insert into public.saas_accounts(organization_id,contact_id,display_name)
    values(
      p_organization_id,
      p_contact_id,
      coalesce(nullif(trim(p_display_name),''),'Cliente SaaS')
    )
    returning id into v_account_id;
    v_account_created := true;
  end if;

  if v_identity_account is null then
    insert into public.saas_account_identities(
      organization_id,account_id,source,external_customer_id
    ) values(
      p_organization_id,v_account_id,p_source,p_external_customer_id
    );
    v_identity_created := true;
  end if;

  if nullif(trim(p_display_name),'') is not null then
    update public.saas_accounts
    set display_name=p_display_name
    where id=v_account_id
      and organization_id=p_organization_id
      and (display_name is null or v_account_created or v_contact_linked);
  end if;

  return jsonb_build_object(
    'account_id',v_account_id,
    'account_created',v_account_created,
    'identity_created',v_identity_created,
    'contact_linked',v_contact_linked
  );
end;
$$;

revoke all on function public.fn_reconcile_saas_contact_identity(
  uuid,uuid,text,text,text
) from public, anon, authenticated;
grant execute on function public.fn_reconcile_saas_contact_identity(
  uuid,uuid,text,text,text
) to authenticated, service_role;

create or replace function public.fn_resolve_saas_account(
  p_organization_id uuid,
  p_source text,
  p_external_customer_id text,
  p_display_name text default null,
  p_allow_create boolean default true
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid;
begin
  if not auth.is_server_service()
     and coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'server_service_required' using errcode='42501';
  end if;

  if nullif(trim(p_source),'') is null
     or nullif(trim(p_external_customer_id),'') is null then
    raise exception 'invalid_customer_identity' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_organization_id::text || ':' || p_source || ':' || p_external_customer_id,
      0
    )
  );

  select i.account_id into v_account_id
  from public.saas_account_identities i
  where i.organization_id=p_organization_id
    and i.source=p_source
    and i.external_customer_id=p_external_customer_id
  limit 1;

  if v_account_id is not null then
    if nullif(trim(p_display_name),'') is not null then
      update public.saas_accounts
      set display_name=coalesce(display_name,p_display_name)
      where id=v_account_id and organization_id=p_organization_id;
    end if;
    return v_account_id;
  end if;

  if not p_allow_create then
    raise exception 'saas_customer_identity_not_found' using errcode='P0002';
  end if;

  insert into public.saas_accounts(organization_id,display_name)
  values(
    p_organization_id,
    coalesce(nullif(trim(p_display_name),''),'Cliente ' || left(p_external_customer_id,12))
  )
  returning id into v_account_id;

  insert into public.saas_account_identities(
    organization_id,account_id,source,external_customer_id
  ) values(
    p_organization_id,v_account_id,p_source,p_external_customer_id
  );

  return v_account_id;
end;
$$;

revoke all on function public.fn_resolve_saas_account(
  uuid,text,text,text,boolean
) from public, anon, authenticated;
grant execute on function public.fn_resolve_saas_account(
  uuid,text,text,text,boolean
) to authenticated, service_role;

create or replace function public.fn_ingest_revenue_observation(
  p_organization_id uuid,
  p_account_id uuid,
  p_source text,
  p_external_event_id text,
  p_external_subscription_id text,
  p_external_customer_id text,
  p_status text,
  p_mrr_cents bigint,
  p_observed_at timestamptz,
  p_started_at timestamptz default null,
  p_ended_at timestamptz default null,
  p_baseline boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_previous_status text;
  v_previous_mrr bigint := 0;
  v_previous_observed_at timestamptz;
  v_previous_recurring bigint := 0;
  v_current_recurring bigint := 0;
  v_had_previous boolean := false;
  v_had_baseline boolean := false;
  v_event_type text := null;
  v_delta bigint := 0;
  v_effective_at timestamptz := p_observed_at;
  v_event_id uuid;
begin
  if not auth.is_server_service()
     and coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'server_service_required' using errcode='42501';
  end if;

  if p_status not in ('active','past_due','canceling','canceled','unknown') then
    raise exception 'invalid_revenue_status' using errcode='22023';
  end if;
  if p_mrr_cents < 0 then
    raise exception 'invalid_mrr' using errcode='22023';
  end if;
  if not exists(
    select 1 from public.saas_accounts
    where id=p_account_id and organization_id=p_organization_id
  ) then
    raise exception 'account_not_found' using errcode='P0002';
  end if;

  -- Serializa somente esta assinatura: duas observações concorrentes não podem
  -- calcular o movimento sobre o mesmo estado anterior.
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_organization_id::text || ':' || p_source || ':' || p_external_subscription_id,
      0
    )
  );

  select s.status, s.mrr_cents, s.last_observed_at
    into v_previous_status, v_previous_mrr, v_previous_observed_at
  from public.revenue_subscription_states s
  where s.organization_id=p_organization_id
    and s.source=p_source
    and s.external_subscription_id=p_external_subscription_id
  for update;
  v_had_previous := found;

  if v_had_previous and p_observed_at < v_previous_observed_at then
    return jsonb_build_object(
      'baseline',false,
      'ignored',true,
      'reason','stale_observation',
      'event',null
    );
  end if;

  select exists(
    select 1 from public.revenue_source_baselines b
    where b.organization_id=p_organization_id and b.source=p_source
  ) into v_had_baseline;

  insert into public.revenue_source_baselines(
    organization_id,source,baseline_at,last_observed_at
  ) values(
    p_organization_id,p_source,p_observed_at,p_observed_at
  )
  on conflict(organization_id,source) do update set
    last_observed_at=greatest(
      public.revenue_source_baselines.last_observed_at,
      excluded.last_observed_at
    );

  insert into public.revenue_subscription_states(
    organization_id,account_id,source,external_subscription_id,
    external_customer_id,status,mrr_cents,started_at,ended_at,
    first_observed_at,last_observed_at
  ) values(
    p_organization_id,p_account_id,p_source,p_external_subscription_id,
    p_external_customer_id,p_status,p_mrr_cents,p_started_at,p_ended_at,
    p_observed_at,p_observed_at
  )
  on conflict(organization_id,source,external_subscription_id) do update set
    account_id=excluded.account_id,
    external_customer_id=excluded.external_customer_id,
    status=excluded.status,
    mrr_cents=excluded.mrr_cents,
    started_at=coalesce(
      public.revenue_subscription_states.started_at,
      excluded.started_at
    ),
    ended_at=excluded.ended_at,
    last_observed_at=greatest(
      public.revenue_subscription_states.last_observed_at,
      excluded.last_observed_at
    );

  if (not v_had_baseline) or p_baseline then
    return jsonb_build_object(
      'baseline',true,
      'event',null
    );
  end if;

  if v_had_previous and v_previous_status in ('active','past_due','canceling') then
    v_previous_recurring := v_previous_mrr;
  end if;
  if p_status in ('active','past_due','canceling') then
    v_current_recurring := p_mrr_cents;
  end if;

  if not v_had_previous and v_current_recurring > 0 then
    v_event_type := 'new';
    v_delta := v_current_recurring;
    v_effective_at := coalesce(p_started_at,p_observed_at);
  elsif v_previous_recurring = 0 and v_current_recurring > 0 then
    v_event_type := 'reactivation';
    v_delta := v_current_recurring;
  elsif v_previous_recurring > 0 and v_current_recurring = 0 then
    v_event_type := 'churn';
    v_delta := -v_previous_recurring;
    v_effective_at := coalesce(p_ended_at,p_observed_at);
  elsif v_previous_recurring > 0
    and v_current_recurring > 0
    and v_previous_recurring <> v_current_recurring then
    if v_current_recurring > v_previous_recurring then
      v_event_type := 'expansion';
    else
      v_event_type := 'contraction';
    end if;
    v_delta := v_current_recurring-v_previous_recurring;
  end if;

  if v_event_type is null then
    return jsonb_build_object('baseline',false,'event',null);
  end if;

  insert into public.revenue_mrr_events(
    organization_id,account_id,source,external_subscription_id,
    external_customer_id,event_type,effective_at,delta_cents,
    previous_mrr_cents,current_mrr_cents,idempotency_key
  ) values(
    p_organization_id,p_account_id,p_source,p_external_subscription_id,
    p_external_customer_id,v_event_type,v_effective_at,v_delta,
    v_previous_recurring,v_current_recurring,
    p_source || ':' || p_external_event_id
  )
  on conflict(organization_id,idempotency_key) do nothing
  returning id into v_event_id;

  return jsonb_build_object(
    'baseline',false,
    'event',
      case when v_event_id is null then null
      else jsonb_build_object(
        'id',v_event_id,
        'event_type',v_event_type,
        'delta_cents',v_delta
      ) end
  );
end;
$$;

revoke all on function public.fn_ingest_revenue_observation(
  uuid,uuid,text,text,text,text,text,bigint,timestamptz,timestamptz,timestamptz,boolean
) from public, anon, authenticated;
grant execute on function public.fn_ingest_revenue_observation(
  uuid,uuid,text,text,text,text,text,bigint,timestamptz,timestamptz,timestamptz,boolean
) to authenticated, service_role;

create or replace function public.fn_ingest_product_event(
  p_organization_id uuid, p_account_id uuid, p_source text,
  p_external_event_id text, p_event_name text, p_occurred_at timestamptz,
  p_properties jsonb default '{}'::jsonb
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_event_id uuid;
begin
  if not auth.is_server_service()
     and coalesce(auth.jwt()->>'role','') <> 'service_role' then
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
