begin;
drop function if exists public.fn_channel_connection_busy(uuid,uuid);
do $policy$
begin
 if to_regprocedure('public.fn_neon_service_identity_ok()') is not null then
  grant select on public.channel_connection_requests to authenticated;
  drop policy if exists channel_connection_requests_select_tecnico on public.channel_connection_requests;
  create policy channel_connection_requests_select_tecnico on public.channel_connection_requests for select to authenticated using (public.fn_neon_service_identity_ok());
 end if;
end
$policy$;
update public.channel_connection_requests set state='failed',updated_at=now() where state='processing' and lease_until<=now();
commit;
