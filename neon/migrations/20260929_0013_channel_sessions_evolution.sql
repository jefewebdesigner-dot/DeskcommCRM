-- Neon: `provider = 'evolution'` em channel_sessions + RPC de reserva (espelho da migration canônica 0345).

begin;

alter table public.channel_sessions
  add column if not exists evolution_instance_name text;

alter table public.channel_sessions drop constraint if exists channel_sessions_provider_check;
alter table public.channel_sessions add constraint channel_sessions_provider_check
  check (provider = any (array['waha'::text, 'meta_cloud'::text, 'zernio'::text, 'wacalls'::text, 'evolution'::text]));

alter table public.channel_sessions drop constraint if exists channel_sessions_provider_ref_check;
alter table public.channel_sessions add constraint channel_sessions_provider_ref_check
  check (
    ((provider = 'waha'::text) and (waha_session_name is not null))
    or ((provider = 'meta_cloud'::text) and (meta_phone_number_id is not null))
    or ((provider = 'zernio'::text) and (zernio_account_id is not null))
    or ((provider = 'wacalls'::text) and (wacalls_session_id is not null))
    or ((provider = 'evolution'::text) and (evolution_instance_name is not null))
  );

create unique index if not exists channel_sessions_evolution_instance_name_unique
  on public.channel_sessions (evolution_instance_name)
  where evolution_instance_name is not null;

-- Reserva a conexão de um canal Evolution: mesmo contrato de idempotência/lease do
-- `fn_reserve_channel_connection` (WAHA), mas cria a linha `provider='evolution'`, e
-- GERA + CIFRA o segredo do webhook da sessão (devolvido em claro UMA vez, só para o
-- servidor do CRM configurar o cabeçalho na instância; nunca chega ao navegador).
-- `fn_finish_channel_connection` é genérica e continua sendo a que fecha o recibo.
create or replace function public.fn_reserve_evolution_connection(
  p_org uuid, p_key uuid, p_hash text, p_display_name text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  receipt public.channel_connection_requests;
  channel public.channel_sessions;
  token uuid := gen_random_uuid();
  segredo text;
begin
  if auth.uid() is null or not public.fn_role_at_least(p_org, 'admin') or not public.fn_support_write_allowed(p_org)
  then raise exception 'connection_forbidden' using errcode = '42501'; end if;
  if not public.fn_session_mfa_proven() then raise exception 'connection_mfa_required' using errcode = '42501'; end if;
  if p_key is null or p_hash is null or length(p_hash) <> 64 or length(coalesce(p_display_name, '')) > 100 then
    raise exception 'connection_invalid_request' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org::text, 2281));
  delete from public.channel_connection_requests where organization_id = p_org and idempotency_key = p_key
    and state = 'succeeded' and updated_at < now() - interval '24 hours';
  select * into receipt from public.channel_connection_requests where organization_id = p_org and idempotency_key = p_key for update;
  if found then
    if receipt.request_hash <> p_hash then raise exception 'idempotency_conflict' using errcode = '22023'; end if;
    if receipt.state = 'succeeded' then
      select * into channel from public.channel_sessions where organization_id = p_org and id = receipt.channel_session_id;
      return jsonb_build_object('replay', true, 'channel', to_jsonb(channel) - 'webhook_secret_encrypted', 'receipt_id', receipt.id);
    end if;
    if receipt.state = 'processing' and receipt.lease_until > now() then
      raise exception 'connection_in_progress' using errcode = '55P03'; end if;
    select * into channel from public.channel_sessions where organization_id = p_org and id = receipt.channel_session_id for update;
    if not found then raise exception 'connection_reservation_missing' using errcode = 'P0002'; end if;
  else
    insert into public.channel_sessions(organization_id, provider, evolution_instance_name, display_name, engine,
      webhook_path_token, webhook_secret_encrypted, status, last_status_change_at, consecutive_health_fails,
      daily_message_limit, metadata)
    values (p_org, 'evolution',
      'evo_' || left(replace(p_org::text, '-', ''), 8) || '_' || left(replace(gen_random_uuid()::text, '-', ''), 16),
      p_display_name, 'NOWEB', replace(gen_random_uuid()::text, '-', ''), '\x00'::bytea, 'STARTING', now(), 0, 250,
      '{"ai_gate":"allowlist","ai_gate_mode":"pre_go_live","ai_test_phone_numbers":[]}'::jsonb)
    returning * into channel;
    if exists (select 1 from public.channel_connection_requests where organization_id = p_org and channel_session_id = channel.id
      and state = 'processing' and lease_until > now()) then raise exception 'connection_in_progress' using errcode = '55P03'; end if;
    insert into public.channel_connection_requests(organization_id, idempotency_key, request_hash, channel_session_id)
      values (p_org, p_key, p_hash, channel.id) returning * into receipt;
  end if;
  update public.channel_connection_requests set state = 'processing', lease_token = token,
    lease_until = now() + interval '5 minutes', remote_created = false, updated_at = now()
    where organization_id = p_org and id = receipt.id;
  -- Segredo novo a cada tentativa: se a instância já existe do outro lado, o CRM só reaplica o cabeçalho.
  segredo := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update public.channel_sessions set status = 'STARTING', status_reason = 'connection_pending',
    last_status_change_at = now(), webhook_secret_encrypted = public.fn_encrypt_oauth(segredo)
    where organization_id = p_org and id = channel.id returning * into channel;
  return jsonb_build_object('replay', false, 'channel', to_jsonb(channel) - 'webhook_secret_encrypted',
    'receipt_id', receipt.id, 'lease_token', token, 'webhook_secret', segredo);
end;
$$;
revoke all on function public.fn_reserve_evolution_connection(uuid, uuid, text, text) from public, anon;
grant execute on function public.fn_reserve_evolution_connection(uuid, uuid, text, text) to authenticated;

do $g$
declare r record;
begin
  for r in select rolname from pg_roles where rolname like 'gravity_app_%' loop
    execute format('grant execute on function public.fn_reserve_evolution_connection(uuid, uuid, text, text) to %I', r.rolname);
  end loop;
end
$g$;

insert into public.neon_schema_migrations(version, note)
values ('20260929_0013_channel_sessions_evolution', 'provider evolution em channel_sessions e fn_reserve_evolution_connection')
on conflict (version) do nothing;

commit;
