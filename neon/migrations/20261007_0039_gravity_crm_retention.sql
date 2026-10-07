-- Gravity CRM — Retention Intelligence + Preventive Cancel Flow
-- 2026-10-07
begin;

create unique index if not exists revenue_mrr_events_id_org_unique
  on public.revenue_mrr_events (id, organization_id);

create table if not exists public.retention_churn_diagnoses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid,
  revenue_mrr_event_id uuid not null,
  reason text not null check (reason in (
    'price','low_usage','missing_feature','competitor',
    'technical_issue','delinquency','business_closed','other'
  )),
  reason_detail text,
  competitor_name text,
  captured_by uuid references neon_auth."user"(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, revenue_mrr_event_id),
  foreign key (account_id, organization_id)
    references public.saas_accounts(id, organization_id) on delete set null (account_id),
  foreign key (revenue_mrr_event_id, organization_id)
    references public.revenue_mrr_events(id, organization_id) on delete cascade,
  check (reason <> 'competitor' or nullif(trim(competitor_name),'') is not null)
);
create index if not exists retention_churn_diagnoses_org_reason_idx
  on public.retention_churn_diagnoses (organization_id, reason, created_at desc);

create table if not exists public.retention_cancel_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  source text not null check (source ~ '^[a-z][a-z0-9_-]{1,49}$'),
  external_session_id text not null,
  status text not null default 'open' check (status in ('open','offer_presented','saved','cancelled','abandoned')),
  reason text check (reason is null or reason in ('price','low_usage','missing_feature','competitor','technical_issue','delinquency','business_closed','other')),
  reason_detail text,
  competitor_name text,
  recommended_offer_type text check (recommended_offer_type is null or recommended_offer_type in ('downgrade','pause','onboarding','roadmap','competitive_review','priority_support','payment_recovery','human_review','none')),
  accepted_offer_type text check (accepted_offer_type is null or accepted_offer_type in ('downgrade','pause','onboarding','roadmap','competitive_review','priority_support','payment_recovery','human_review','none')),
  opening_mrr_cents bigint not null default 0 check (opening_mrr_cents >= 0),
  preserved_mrr_cents bigint not null default 0 check (preserved_mrr_cents >= 0),
  started_at timestamptz not null,
  offer_presented_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source, external_session_id),
  unique (id, organization_id),
  foreign key (account_id, organization_id)
    references public.saas_accounts(id, organization_id) on delete cascade,
  check (reason <> 'competitor' or nullif(trim(competitor_name),'') is not null),
  check (status = 'saved' or preserved_mrr_cents = 0),
  check (status <> 'saved' or accepted_offer_type is not null),
  check (status in ('open','offer_presented') or resolved_at is not null)
);
create index if not exists retention_cancel_sessions_org_status_idx
  on public.retention_cancel_sessions (organization_id, status, started_at desc);

create table if not exists public.retention_cancel_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null,
  source text not null,
  external_event_id text not null,
  event_name text not null check (event_name in ('cancel_intent_created','cancel_reason_selected','cancel_offer_presented','cancel_offer_accepted','cancellation_confirmed','cancel_session_abandoned')),
  reason text,
  offer_type text,
  preserved_mrr_cents bigint not null default 0 check (preserved_mrr_cents >= 0),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (organization_id, source, external_event_id),
  foreign key (session_id, organization_id)
    references public.retention_cancel_sessions(id, organization_id) on delete cascade
);

alter table public.retention_churn_diagnoses enable row level security;
alter table public.retention_cancel_sessions enable row level security;
alter table public.retention_cancel_events enable row level security;

do $policies$
declare t text;
begin
  foreach t in array array['retention_churn_diagnoses','retention_cancel_sessions','retention_cancel_events']
  loop
    execute format('drop policy if exists gravity_crm_tenant_select on public.%I',t);
    execute format('drop policy if exists gravity_crm_tenant_write on public.%I',t);
    execute format('create policy gravity_crm_tenant_select on public.%I for select using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin())',t);
    execute format(
      'create policy gravity_crm_tenant_write on public.%I for all using (public.fn_is_platform_admin() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, ''manager''))) with check (public.fn_is_platform_admin() or (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, ''manager'')))',
      t
    );
    execute format('revoke all on public.%I from anon',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end
$policies$;

drop trigger if exists trg_retention_churn_diagnoses_updated_at on public.retention_churn_diagnoses;
create trigger trg_retention_churn_diagnoses_updated_at before update on public.retention_churn_diagnoses
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_retention_cancel_sessions_updated_at on public.retention_cancel_sessions;
create trigger trg_retention_cancel_sessions_updated_at before update on public.retention_cancel_sessions
  for each row execute function public.fn_set_updated_at();

create or replace function public.fn_ingest_retention_cancel_event(
  p_organization_id uuid,p_account_id uuid,p_source text,p_external_session_id text,p_external_event_id text,
  p_event_name text,p_occurred_at timestamptz,p_opening_mrr_cents bigint default 0,p_reason text default null,
  p_reason_detail text default null,p_competitor_name text default null,p_offer_type text default null,
  p_recommended_offer_type text default null,p_preserved_mrr_cents bigint default 0
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_session public.retention_cancel_sessions%rowtype; v_event uuid;
begin
  if not auth.is_server_service() then
    raise exception 'server_service_required' using errcode='42501';
  end if;

  if not exists(select 1 from public.saas_accounts where id=p_account_id and organization_id=p_organization_id)
    then raise exception using errcode='P0001',message='retention_account_not_found'; end if;
  select * into v_session from public.retention_cancel_sessions
    where organization_id=p_organization_id and source=p_source and external_session_id=p_external_session_id for update;
  if not found then
    if p_event_name<>'cancel_intent_created' then raise exception using errcode='P0001',message='retention_session_not_found'; end if;
    insert into public.retention_cancel_sessions(organization_id,account_id,source,external_session_id,opening_mrr_cents,started_at)
      values(p_organization_id,p_account_id,p_source,p_external_session_id,p_opening_mrr_cents,p_occurred_at) returning * into v_session;
  elsif v_session.account_id<>p_account_id then
    raise exception using errcode='P0001',message='retention_session_account_mismatch';
  end if;

  insert into public.retention_cancel_events(organization_id,session_id,source,external_event_id,event_name,reason,offer_type,preserved_mrr_cents,occurred_at)
    values(p_organization_id,v_session.id,p_source,p_external_event_id,p_event_name,p_reason,p_offer_type,p_preserved_mrr_cents,p_occurred_at)
    on conflict(organization_id,source,external_event_id) do nothing returning id into v_event;
  if v_event is null then
    return jsonb_build_object('accepted',false,'duplicate',true,'session_id',v_session.id,'status',v_session.status);
  end if;
  if v_session.status in ('saved','cancelled','abandoned') then
    raise exception using errcode='P0001',message='retention_session_terminal';
  end if;

  if p_event_name='cancel_reason_selected' then
    update public.retention_cancel_sessions set reason=p_reason,reason_detail=nullif(trim(p_reason_detail),''),
      competitor_name=case when p_reason='competitor' then nullif(trim(p_competitor_name),'') else null end,
      recommended_offer_type=p_recommended_offer_type where id=v_session.id;
  elsif p_event_name='cancel_offer_presented' then
    update public.retention_cancel_sessions set status='offer_presented',
      recommended_offer_type=coalesce(p_offer_type,recommended_offer_type),offer_presented_at=p_occurred_at where id=v_session.id;
  elsif p_event_name='cancel_offer_accepted' then
    if p_offer_type is null or p_offer_type='none' or p_preserved_mrr_cents<=0 or p_preserved_mrr_cents>v_session.opening_mrr_cents
      then raise exception using errcode='P0001',message='retention_invalid_saved_outcome'; end if;
    update public.retention_cancel_sessions set status='saved',accepted_offer_type=p_offer_type,
      preserved_mrr_cents=p_preserved_mrr_cents,offer_presented_at=coalesce(offer_presented_at,p_occurred_at),
      resolved_at=p_occurred_at where id=v_session.id;
  elsif p_event_name='cancellation_confirmed' then
    update public.retention_cancel_sessions set status='cancelled',preserved_mrr_cents=0,resolved_at=p_occurred_at where id=v_session.id;
  elsif p_event_name='cancel_session_abandoned' then
    update public.retention_cancel_sessions set status='abandoned',preserved_mrr_cents=0,resolved_at=p_occurred_at where id=v_session.id;
  end if;

  select * into v_session from public.retention_cancel_sessions where id=v_session.id;
  return jsonb_build_object('accepted',true,'duplicate',false,'session_id',v_session.id,'status',v_session.status);
end;
$$;
revoke all on function public.fn_ingest_retention_cancel_event(uuid,uuid,text,text,text,text,timestamptz,bigint,text,text,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.fn_ingest_retention_cancel_event(uuid,uuid,text,text,text,text,timestamptz,bigint,text,text,text,text,text,bigint) to authenticated, service_role;

insert into public.neon_schema_migrations(version,note)
values('20261007_0039_gravity_crm_retention','Gravity CRM: churn diagnosis, preventive cancellation and retention audit')
on conflict(version) do update set applied_at=excluded.applied_at,note=excluded.note;

notify pgrst,'reload schema';
commit;
