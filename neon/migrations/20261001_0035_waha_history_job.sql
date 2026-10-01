-- Backfill histórico do WhatsApp na fila durável do worker.
-- Um canal enfileira um único job inicial ao entrar em WORKING.

begin;

alter table public.job_queue drop constraint if exists job_queue_kind_check;
alter table public.job_queue
  add constraint job_queue_kind_check
  check(kind in(
    'inbound_turn','followup_turn','watchdog','flywheel','case_reply_turn',
    'operator_turn','transactional_delivery','approved_reply','waha_history_sync'
  ));

create or replace function public.fn_enqueue_waha_history_sync(
  p_org uuid,
  p_channel uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job uuid;
begin
  if not (
    session_user = 'service_role'
    or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role','') = 'service_role'
    or (
      auth.uid() is not null
      and exists (
        select 1
          from public.neon_service_identities s
         where s.user_id = auth.uid()
           and s.organization_id = p_org
           and s.active
           and s.kind = 'server'
      )
    )
  ) then
    raise exception 'waha_history_enqueue_forbidden' using errcode='42501';
  end if;

  if not exists (
    select 1
      from public.channel_sessions c
     where c.id = p_channel
       and c.organization_id = p_org
       and c.archived_at is null
  ) then
    raise exception 'waha_history_channel_not_found' using errcode='P0002';
  end if;

  insert into public.job_queue(
    organization_id,contact_id,kind,source_event_id,payload,
    priority,run_after,max_attempts
  )
  values(
    p_org,null,'waha_history_sync',p_channel,
    jsonb_build_object('channel_session_id',p_channel,'chat_offset',0),
    180,clock_timestamp()+interval '90 seconds',8
  )
  on conflict (organization_id,source_event_id)
    where source_event_id is not null
  do nothing
  returning id into v_job;

  if v_job is null then
    select id into v_job
      from public.job_queue
     where organization_id=p_org
       and source_event_id=p_channel
     limit 1;
  end if;

  return v_job;
end;
$$;

revoke all on function public.fn_enqueue_waha_history_sync(uuid,uuid)
  from public,anon;
grant execute on function public.fn_enqueue_waha_history_sync(uuid,uuid)
  to authenticated,service_role;

insert into public.neon_schema_migrations(version,note)
values(
  '20261001_0035_waha_history_job',
  'Backfill WhatsApp entra na fila duravel uma vez por canal ao atingir WORKING'
)
on conflict(version) do update
set applied_at=excluded.applied_at,note=excluded.note;

notify pgrst, 'reload schema';
commit;
