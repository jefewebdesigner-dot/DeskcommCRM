-- Callback OAuth do Google Agenda: queima de nonce pela identidade técnica Neon.
-- O Data API usa role authenticated + JWT técnico; dar INSERT direto na tabela
-- abriria a superfície para qualquer sessão autenticada. A RPC confere a
-- identidade técnica e preserva a UNIQUE do nonce como trava anti-replay.

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
begin
  if not public.fn_neon_service_identity_ok() then
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
  from public, anon;
grant execute on function public.fn_calendar_oauth_nonce_burn(text,uuid,uuid,timestamptz)
  to authenticated, service_role;

do $grants$
declare r record;
begin
  for r in select rolname from pg_roles where rolname ~ '^gravity_app_' loop
    execute format(
      'grant execute on function public.fn_calendar_oauth_nonce_burn(text,uuid,uuid,timestamptz) to %I',
      r.rolname
    );
  end loop;
end
$grants$;

insert into public.neon_schema_migrations(version,note)
values(
  '20261001_0026_google_agenda_nonce_tecnico',
  'Callback Google Agenda queima nonce via RPC restrita a identidade tecnica Neon'
)
on conflict(version) do update
set applied_at=excluded.applied_at,note=excluded.note;

notify pgrst, 'reload schema';

commit;
