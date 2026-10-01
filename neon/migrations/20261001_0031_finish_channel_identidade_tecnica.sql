-- Neon — concluir conexão WAHA com identidade técnica escopada à organização.
begin;

create or replace function public.fn_finish_channel_connection(
  p_org uuid,
  p_receipt uuid,
  p_lease uuid,
  p_status text,
  p_reason text default null,
  p_created boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  receipt public.channel_connection_requests;
  channel public.channel_sessions;
begin
  if not (
    session_user = 'service_role'
    or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
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
    raise exception 'connection_finish_forbidden' using errcode = '42501';
  end if;

  select * into receipt
    from public.channel_connection_requests
   where organization_id = p_org
     and id = p_receipt
   for update;

  if not found or receipt.state <> 'processing' or receipt.lease_token <> p_lease
     or receipt.lease_until <= now() then
    raise exception 'connection_lease_lost' using errcode = '55P03';
  end if;

  if p_status = 'remote_created' then
    update public.channel_connection_requests
       set remote_created = true, updated_at = now()
     where organization_id = p_org and id = p_receipt;
    return '{}'::jsonb;
  end if;

  if p_status not in ('STARTING','SCAN_QR_CODE','WORKING','FAILED') then
    raise exception 'connection_invalid_status' using errcode = '22023';
  end if;

  update public.channel_sessions
     set status = p_status,
         status_reason = left(p_reason, 200),
         last_status_change_at = now(),
         consecutive_health_fails = case when p_status = 'FAILED' then consecutive_health_fails else 0 end,
         archived_at = case when p_status <> 'FAILED' then null else archived_at end,
         phone_number = case when archived_at is not null and p_status <> 'FAILED' then null else phone_number end
   where organization_id = p_org
     and id = receipt.channel_session_id
  returning * into channel;

  if not found then
    raise exception 'connection_reservation_missing' using errcode = 'P0002';
  end if;

  update public.channel_connection_requests
     set state = case when p_status = 'FAILED' then 'failed' else 'succeeded' end,
         remote_created = remote_created or p_created,
         updated_at = now()
   where organization_id = p_org and id = p_receipt;

  return to_jsonb(channel);
end
$function$;

revoke execute on function public.fn_finish_channel_connection(uuid,uuid,uuid,text,text,boolean)
  from public, anon;
grant execute on function public.fn_finish_channel_connection(uuid,uuid,uuid,text,text,boolean)
  to authenticated, service_role;

insert into public.neon_schema_migrations(version,note)
values(
  '20261001_0031_finish_channel_identidade_tecnica',
  'fn_finish_channel_connection aceita somente service_role ou identidade tecnica Neon da mesma organizacao'
)
on conflict(version) do update
set applied_at=excluded.applied_at,note=excluded.note;

notify pgrst, 'reload schema';
commit;
