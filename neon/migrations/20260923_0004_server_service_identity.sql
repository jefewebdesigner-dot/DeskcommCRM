-- Neon homologation/runtime — identidade técnica server-only.
-- Preserva o equivalente funcional do antigo service_role sem dar DDL,
-- SUPERUSER ou BYPASSRLS ao papel da aplicação/Data API.

begin;

create table if not exists public.neon_service_identities (
  user_id uuid primary key references neon_auth."user"(id) on delete cascade,
  kind text not null default 'server' check (kind = 'server'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

revoke all on public.neon_service_identities from public;
revoke all on public.neon_service_identities from anon;
revoke all on public.neon_service_identities from authenticated;

create or replace function auth.is_server_service()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.neon_service_identities s
    where s.user_id = auth.uid()
      and s.active
  )
$$;

revoke all on function auth.is_server_service() from public;
grant execute on function auth.is_server_service() to authenticated;

-- O Data API executa JWTs Neon Auth sob a role authenticated. Só tabelas
-- com RLS recebem grants aqui: conceder DML globalmente também abriria qualquer
-- tabela sem RLS para usuários normais.
grant usage on schema public to authenticated;

do $policies$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and c.relname <> 'neon_service_identities'
  loop
    execute format(
      'grant select, insert, update, delete on public.%I to authenticated',
      r.relname
    );

    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = r.relname
        and policyname = 'neon_server_service_all'
    ) then
      execute format(
        'create policy neon_server_service_all on public.%I for all to authenticated using (auth.is_server_service()) with check (auth.is_server_service())',
        r.relname
      );
    end if;
  end loop;
end
$policies$;

-- Funções seguem a autorização interna de cada RPC; não concedemos tabelas
-- sem RLS por efeito colateral.
grant execute on all functions in schema public to authenticated;

insert into public.neon_schema_migrations(version, note)
values (
  '20260923_0004_server_service_identity',
  'Server-only Neon Auth identity with RLS policy bypass by UUID, not DB privilege'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    note = excluded.note;

commit;
