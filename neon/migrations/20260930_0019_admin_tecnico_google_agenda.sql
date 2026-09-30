-- Neon — acesso técnico seguro às credenciais do Google Agenda.
--
-- O Data API apresenta a identidade técnica com role authenticated.
-- Em vez de abrir tabelas/segredos para toda sessão autenticada, estas RPCs
-- SECURITY DEFINER conferem se auth.uid() é uma identidade técnica ativa.
-- service_role continua compatível. Idempotente.

begin;

create or replace function public.fn_neon_service_identity_ok()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (auth.uid() is not null and exists (
      select 1
      from public.neon_service_identities s
      where s.user_id = auth.uid()
        and s.active
        and s.kind = 'server'
    ))
    or session_user = 'service_role'
    or session_user ~ '^gravity_app_[a-z0-9]+$'
    or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    or coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    ) = 'service_role';
$$;

revoke all on function public.fn_neon_service_identity_ok() from public, anon;
grant execute on function public.fn_neon_service_identity_ok() to authenticated, service_role;

create or replace function public.fn_service_encrypt_oauth(plaintext text)
returns bytea
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
begin
  if not public.fn_neon_service_identity_ok() then
    raise exception 'service identity required' using errcode = '42501';
  end if;
  return public.fn_encrypt_oauth(plaintext);
end;
$$;

create or replace function public.fn_service_decrypt_oauth(ciphertext bytea)
returns text
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
begin
  if not public.fn_neon_service_identity_ok() then
    raise exception 'service identity required' using errcode = '42501';
  end if;
  return public.fn_decrypt_oauth(ciphertext);
end;
$$;

revoke all on function public.fn_service_encrypt_oauth(text) from public, anon;
revoke all on function public.fn_service_decrypt_oauth(bytea) from public, anon;
grant execute on function public.fn_service_encrypt_oauth(text) to authenticated, service_role;
grant execute on function public.fn_service_decrypt_oauth(bytea) to authenticated, service_role;

create or replace function public.fn_platform_google_oauth_get()
returns table (
  client_id text,
  client_secret_encrypted bytea,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.fn_neon_service_identity_ok() then
    raise exception 'service identity required' using errcode = '42501';
  end if;

  return query
  select p.client_id, p.client_secret_encrypted, p.updated_at
  from public.platform_google_oauth p
  where p.id = 1;
end;
$$;

create or replace function public.fn_platform_google_oauth_put(
  p_client_id text,
  p_client_secret_encrypted bytea default null,
  p_updated_by uuid default null
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

  if p_client_id is null or length(btrim(p_client_id)) < 10 then
    raise exception 'client_id inválido' using errcode = '22023';
  end if;

  insert into public.platform_google_oauth (
    id, client_id, client_secret_encrypted, updated_by
  )
  values (
    1, btrim(p_client_id), p_client_secret_encrypted, p_updated_by
  )
  on conflict (id) do update
  set client_id = excluded.client_id,
      client_secret_encrypted = coalesce(
        excluded.client_secret_encrypted,
        public.platform_google_oauth.client_secret_encrypted
      ),
      updated_by = excluded.updated_by,
      updated_at = now();
end;
$$;

revoke all on function public.fn_platform_google_oauth_get() from public, anon;
revoke all on function public.fn_platform_google_oauth_put(text,bytea,uuid) from public, anon;
grant execute on function public.fn_platform_google_oauth_get() to authenticated, service_role;
grant execute on function public.fn_platform_google_oauth_put(text,bytea,uuid) to authenticated, service_role;

do $grants$
declare r record;
begin
  for r in select rolname from pg_roles where rolname like 'gravity_app\_%' loop
    execute format('grant execute on function public.fn_service_encrypt_oauth(text) to %I', r.rolname);
    execute format('grant execute on function public.fn_service_decrypt_oauth(bytea) to %I', r.rolname);
    execute format('grant execute on function public.fn_platform_google_oauth_get() to %I', r.rolname);
    execute format('grant execute on function public.fn_platform_google_oauth_put(text,bytea,uuid) to %I', r.rolname);
  end loop;
end
$grants$;

insert into public.neon_schema_migrations(version, note)
values (
  '20260930_0019_admin_tecnico_google_agenda',
  'Admin técnico Neon acessa OAuth Google e cifra por RPCs autoautorizadas'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    note = excluded.note;

notify pgrst, 'reload schema';

commit;
