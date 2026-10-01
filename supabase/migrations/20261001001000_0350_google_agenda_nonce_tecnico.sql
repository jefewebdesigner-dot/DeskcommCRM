-- Callback OAuth do Google Agenda: queima do nonce por RPC server-only.
-- Em Supabase o service_role continua autorizado; em Neon a mesma RPC valida a
-- identidade técnica quando fn_neon_service_identity_ok() existir.

begin;

create or replace function public.fn_calendar_oauth_nonce_burn(
  p_nonce text,
  p_org uuid,
  p_user uuid,
  p_expira timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ok boolean := false;
begin
  if session_user = 'service_role'
     or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role','') = 'service_role' then
    v_ok := true;
  elsif to_regprocedure('public.fn_neon_service_identity_ok()') is not null then
    execute 'select public.fn_neon_service_identity_ok()' into v_ok;
  end if;

  if not coalesce(v_ok,false) then
    raise exception 'service identity required' using errcode = '42501';
  end if;

  if p_nonce is null or length(btrim(p_nonce)) < 16
     or p_org is null or p_user is null or p_expira is null then
    raise exception 'oauth nonce inválido' using errcode = '22023';
  end if;

  insert into public.calendar_oauth_nonces (
    nonce, organization_id, user_id, expira_em
  )
  values (p_nonce, p_org, p_user, p_expira);
end;
$$;

revoke all on function public.fn_calendar_oauth_nonce_burn(text,uuid,uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.fn_calendar_oauth_nonce_burn(text,uuid,uuid,timestamptz)
  to service_role;

commit;
