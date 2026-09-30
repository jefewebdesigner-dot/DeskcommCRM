-- Neon — contexto de ORGANIZAÇÃO por transação para o agent-worker.
--
-- O worker conecta com a role restrita de aplicação (`gravity_app_*`), que não é usuária: a RLS de
-- tenant (`organization_id in fn_user_org_ids()`, que lê `auth.uid()`) devolve ZERO linhas para ela.
-- Resolver com BYPASSRLS, dono do banco, service role irrestrito ou membership artificial em todas
-- as organizações está fora de questão. O que entra aqui é acesso técnico ESCOPADO:
--
--   autorização = identidade de serviço registrada PARA aquela organização
--               + prova do processo (segredo cujo hash está no banco)
--               + organização ativa
--               + a linha acessada pertencer à MESMA organização da transação
--
-- O contexto é transaction-local (`set_config(..., true)`): `app.worker_uid`, `app.worker_secret`,
-- `app.worker_org`. Nada é session-global, então nada vaza para o próximo uso da conexão no pool.
--
-- Reusa `neon_service_identities (user_id, organization_id, kind, active)` — o cadastro técnico por
-- organização que já existe em produção — e acrescenta o hash do segredo do processo. Organização
-- sem linha ATIVA nessa tabela é invisível ao worker.
--
-- O plano GLOBAL do worker (claim da fila, laços de manutenção) não lê dado de tenant: usa funções
-- SECURITY DEFINER que devolvem só ids/números, e depois entra no contexto de CADA organização.
--
-- As policies `worker_org_scope` são criadas só PARA as roles `gravity_app_*`: as demais roles (Data
-- API/authenticated) nunca avaliam a expressão, então não precisam de EXECUTE nas funções.
--
-- Idempotente. Reaplique depois de criar uma role `gravity_app_*` nova.

begin;

alter table public.neon_service_identities
  add column if not exists secret_sha256 text;

comment on column public.neon_service_identities.secret_sha256 is
  'sha256 (hex) do segredo do processo worker. O segredo em si vive só no env do worker; sem hash cadastrado a linha não autoriza o worker.';

-- ── Identidade + organização ──────────────────────────────────────────────────────────────

create or replace function public.fn_worker_identity_ok()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(current_setting('app.worker_uid', true), ''), '') <> ''
     and exists (
       select 1 from public.neon_service_identities s
       where s.active and s.kind = 'server' and s.secret_sha256 is not null
         and s.user_id::text = lower(current_setting('app.worker_uid', true))
         and s.secret_sha256 = encode(sha256(convert_to(coalesce(current_setting('app.worker_secret', true), ''), 'UTF8')), 'hex')
     );
$$;

create or replace function public.fn_worker_org()
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid text := nullif(current_setting('app.worker_uid', true), '');
  v_org text := nullif(current_setting('app.worker_org', true), '');
begin
  if v_uid is null or v_org is null then return null; end if;
  if v_org !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  return (
    select o.id
    from public.organizations o
    join public.neon_service_identities s on s.organization_id = o.id
    where o.id = v_org::uuid and o.status = 'active'
      and s.active and s.kind = 'server' and s.secret_sha256 is not null
      and s.user_id::text = lower(v_uid)
      and s.secret_sha256 = encode(sha256(convert_to(coalesce(current_setting('app.worker_secret', true), ''), 'UTF8')), 'hex')
  );
end;
$$;

-- ── Plano global: só ids e números, nunca dado de tenant ─────────────────────────────────

create or replace function public.fn_worker_orgs()
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select o.id
  from public.organizations o
  join public.neon_service_identities s on s.organization_id = o.id
  where public.fn_worker_identity_ok() and o.status = 'active'
    and s.active and s.kind = 'server' and s.user_id::text = lower(current_setting('app.worker_uid', true))
  order by o.id;
$$;

create or replace function public.fn_worker_orgs_com_job_vencido()
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select o.org from public.fn_worker_orgs() o(org)
  where exists (
    select 1 from public.job_queue j
    where j.organization_id = o.org and j.status = 'pending' and j.run_after <= now()
  );
$$;

-- Mesma conta de `faltaParaOProximoJob` (queue.ts), só sobre as organizações do worker.
create or replace function public.fn_worker_ms_para_o_proximo_job()
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select case
           when min(j.run_after) is null then null
           else greatest(extract(epoch from (least(min(j.run_after), now() + interval '1 day') - now())) * 1000, 0)::int
         end
  from public.job_queue j
  where j.status = 'pending' and j.organization_id in (select public.fn_worker_orgs());
$$;

create or replace function public.fn_worker_jobs_em_execucao()
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from public.job_queue j
  where j.status = 'running' and j.organization_id in (select public.fn_worker_orgs());
$$;

-- Contagem por status para o /healthz do worker (só números).
create or replace function public.fn_worker_fila_por_status()
returns table(status text, n integer) language sql stable security definer set search_path = public, pg_temp as $$
  select j.status::text, count(*)::int from public.job_queue j
  where j.organization_id in (select public.fn_worker_orgs())
  group by j.status;
$$;

-- ── Policies ─────────────────────────────────────────────────────────────────────────────

do $policies$
declare
  r record;
  app_roles text;
  -- Identidade/autorização/credenciais de usuário: o worker não tem o que fazer aqui.
  excluidas constant text[] := array[
    'user_organizations', 'api_tokens', 'team_invites', 'platform_support_sessions',
    'neon_service_identities', 'push_subscriptions', 'billing_export_connections'
  ];
begin
  select string_agg(quote_ident(rolname), ', ') into app_roles from pg_roles where rolname like 'gravity_app\_%';
  if app_roles is null then
    raise notice 'nenhuma role gravity_app_* encontrada — policies do worker não criadas';
    return;
  end if;

  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped)
      and c.relname <> all (excluidas)
  loop
    execute format('drop policy if exists worker_org_scope on public.%I', r.relname);
    if r.relname = 'api_audit_log' then
      -- Auditoria é append-only: o worker registra e lê, nunca reescreve nem apaga.
      execute format(
        'create policy worker_org_scope on public.%I for select to %s using (organization_id = (select public.fn_worker_org()))',
        r.relname, app_roles);
      execute format('drop policy if exists worker_org_insert on public.%I', r.relname);
      execute format(
        'create policy worker_org_insert on public.%I for insert to %s with check (organization_id = (select public.fn_worker_org()))',
        r.relname, app_roles);
    else
      execute format(
        'create policy worker_org_scope on public.%I for all to %s using (organization_id = (select public.fn_worker_org())) with check (organization_id = (select public.fn_worker_org()))',
        r.relname, app_roles);
    end if;
  end loop;

  -- A organização da transação, só leitura (fuso, locale, configuração de IA).
  drop policy if exists worker_org_scope on public.organizations;
  execute format(
    'create policy worker_org_scope on public.organizations for select to %s using (id = (select public.fn_worker_org()))',
    app_roles);

  -- Conteúdo GLOBAL estritamente necessário, só leitura e só para a identidade do worker.
  -- `organization_id is null` NÃO é passe livre: cada policy diz qual conteúdo.
  drop policy if exists worker_platform_read on public.playbook_versions;
  execute format(
    'create policy worker_platform_read on public.playbook_versions for select to %s using (organization_id is null and layer = ''platform'' and (select public.fn_worker_identity_ok()))',
    app_roles);
  drop policy if exists worker_platform_read on public.playbook_pointers;
  execute format(
    'create policy worker_platform_read on public.playbook_pointers for select to %s using (organization_id is null and layer = ''platform'' and (select public.fn_worker_identity_ok()))',
    app_roles);
  drop policy if exists worker_platform_read on public.skill_versions;
  execute format(
    'create policy worker_platform_read on public.skill_versions for select to %s using (organization_id is null and (select public.fn_worker_identity_ok()))',
    app_roles);
  drop policy if exists worker_platform_read on public.skill_pointers;
  execute format(
    'create policy worker_platform_read on public.skill_pointers for select to %s using (organization_id is null and (select public.fn_worker_identity_ok()))',
    app_roles);
  drop policy if exists worker_platform_read on public.platform_settings;
  execute format(
    'create policy worker_platform_read on public.platform_settings for select to %s using ((select public.fn_worker_identity_ok()))',
    app_roles);
  drop policy if exists worker_platform_read on public.ai_models;
  execute format(
    'create policy worker_platform_read on public.ai_models for select to %s using ((select public.fn_worker_identity_ok()))',
    app_roles);
  drop policy if exists worker_platform_read on public.ai_pricing;
  execute format(
    'create policy worker_platform_read on public.ai_pricing for select to %s using ((select public.fn_worker_identity_ok()))',
    app_roles);
end
$policies$;

-- ── Grants: só as roles de aplicação executam; nenhuma outra role alcança estas funções ──────

do $grants$
declare
  r record;
  f text;
  fns constant text[] := array[
    'public.fn_worker_identity_ok()', 'public.fn_worker_org()', 'public.fn_worker_orgs()',
    'public.fn_worker_orgs_com_job_vencido()', 'public.fn_worker_ms_para_o_proximo_job()',
    'public.fn_worker_jobs_em_execucao()', 'public.fn_worker_fila_por_status()'
  ];
begin
  foreach f in array fns loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    for r in select rolname from pg_roles where rolname like 'gravity_app\_%' loop
      execute format('grant execute on function %s to %I', f, r.rolname);
    end loop;
  end loop;
end
$grants$;

insert into public.neon_schema_migrations(version, note)
values (
  '20260930_0015_worker_org_context',
  'Contexto de organizacao por transacao para o agent-worker: identidade por organizacao + segredo + policies worker_org_scope; sem bypass de RLS'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    note = excluded.note;

commit;
