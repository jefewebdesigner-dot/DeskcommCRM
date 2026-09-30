-- Neon — o health lê o estado do worker pela identidade de serviço, e só por ela.
--
-- A rota pública de health chama `fn_agent_worker_status()` pelo Data API, que executa como a role
-- `authenticated` com o JWT da identidade técnica do app. Sem EXECUTE para `authenticated` a chamada
-- falhava e o health respondia "status_indisponivel". Conceder EXECUTE puro deixaria qualquer usuário
-- autenticado ler contadores da fila — agregados, mas de instalação, não dele. Então a função agora
-- se autoriza sozinha: devolve NULL a quem não é uma identidade de serviço ativa cadastrada em
-- `neon_service_identities` (ou o próprio worker, com o segredo do processo).
--
-- Substitui a versão da migration canônica 0346 SÓ no Neon (onde a tabela de identidades existe).
-- Idempotente.

begin;

create or replace function public.fn_agent_worker_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when (
      (auth.uid() is not null and exists (
        select 1 from public.neon_service_identities s where s.user_id = auth.uid() and s.active))
      or public.fn_worker_identity_ok()
    ) then jsonb_build_object(
      'registrado', exists (select 1 from public.agent_worker_heartbeats),
      'ultimo_batimento_s', (select extract(epoch from now() - max(last_seen_at))::int from public.agent_worker_heartbeats),
      'ultimo_erro', (select last_error from public.agent_worker_heartbeats where last_error is not null order by last_error_at desc nulls last limit 1),
      'ultimo_erro_em', (select max(last_error_at) from public.agent_worker_heartbeats),
      'pendentes', (select count(*)::int from public.job_queue where status = 'pending'),
      'prontos_atrasados', (select count(*)::int from public.job_queue where status = 'pending' and run_after <= now() - interval '2 minutes'),
      'mais_velho_s', (select extract(epoch from now() - min(run_after))::int from public.job_queue where status = 'pending' and run_after <= now()),
      'em_execucao', (select count(*)::int from public.job_queue where status = 'running')
    )
  end;
$$;

revoke all on function public.fn_agent_worker_status() from public, anon;
grant execute on function public.fn_agent_worker_status() to authenticated, service_role;

do $grants$
declare r record;
begin
  for r in select rolname from pg_roles where rolname like 'gravity_app\_%' loop
    execute format('grant execute on function public.fn_agent_worker_status() to %I', r.rolname);
  end loop;
end
$grants$;

insert into public.neon_schema_migrations(version, note)
values (
  '20260930_0016_worker_status_para_o_health',
  'fn_agent_worker_status se autoriza pela identidade de servico (authenticated so executa se for identidade cadastrada)'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    note = excluded.note;

commit;
