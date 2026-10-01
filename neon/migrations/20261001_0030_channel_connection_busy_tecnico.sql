begin;
drop function if exists public.fn_channel_connection_busy(uuid,uuid);
grant select on public.channel_connection_requests to authenticated;
drop policy if exists channel_connection_requests_select_tecnico on public.channel_connection_requests;
create policy channel_connection_requests_select_tecnico on public.channel_connection_requests for select to authenticated using (public.fn_neon_service_identity_ok());
update public.channel_connection_requests set state='failed',updated_at=now() where state='processing' and lease_until<=now();
insert into public.neon_schema_migrations(version,note) values('20261001_0030_channel_connection_busy_tecnico','Backend tecnico checa leases privadas via RLS; processing expirado vira failed') on conflict(version) do update set applied_at=excluded.applied_at,note=excluded.note;
commit;
