-- 0346 — batimento do agent-worker, visível no health.
--
-- O worker é o ÚNICO consumidor do dispatch de IA e do resgate de mensagens presas. Quando ele
-- morre, nada avisava: a instalação parecia de pé (app e banco respondem) enquanto ninguém
-- atendia. Aqui o worker registra um batimento a cada ~30 s; o health lê a idade dele, o último
-- erro (já sanitizado, ≤200 caracteres, sem PII) e o estado da fila (pendentes e idade do mais
-- velho). Sem batimento algum a resposta é "nunca registrado" — instalação sem worker.
--
-- Tabela SEM organization_id: é da instalação, não de tenant (fora de `fn_aplicar_travas...`).
-- RLS ligada sem policy: ninguém alcança pela REST; escreve/lê só por estas duas funções.
--
-- Idempotente: `create ... if not exists`, `create or replace function`.

create table if not exists public.agent_worker_heartbeats (
  worker_id text primary key,
  started_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  last_error text,
  last_error_at timestamptz
);
alter table public.agent_worker_heartbeats enable row level security;
revoke all on public.agent_worker_heartbeats from public, anon, authenticated;

-- Escrita: o worker (role restrita da aplicação / service_role). O erro é cortado e nunca vem do
-- corpo de mensagem — o chamador já o entrega sanitizado; o corte aqui é só o teto.
create or replace function public.fn_agent_worker_beat(
  p_worker text, p_started timestamptz, p_error text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_worker is null or length(p_worker) > 200 then
    raise exception 'worker_invalido' using errcode = '22023';
  end if;
  insert into public.agent_worker_heartbeats(worker_id, started_at, last_seen_at, last_error, last_error_at)
  values (p_worker, coalesce(p_started, now()), now(), left(p_error, 200), case when p_error is null then null else now() end)
  on conflict (worker_id) do update
    set last_seen_at = now(),
        started_at = excluded.started_at,
        last_error = coalesce(excluded.last_error, public.agent_worker_heartbeats.last_error),
        last_error_at = case when excluded.last_error is null then public.agent_worker_heartbeats.last_error_at else now() end;
  -- Worker que sumiu de vez (ex.: PID novo a cada restart) não se acumula: só os 7 dias recentes.
  delete from public.agent_worker_heartbeats where last_seen_at < now() - interval '7 days';
end;
$$;
revoke all on function public.fn_agent_worker_beat(text, timestamptz, text) from public, anon, authenticated;

-- Leitura para o health: um jsonb agregado, sem linha de tenant e sem conteúdo.
create or replace function public.fn_agent_worker_status()
returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'registrado', exists (select 1 from public.agent_worker_heartbeats),
    'ultimo_batimento_s', (select extract(epoch from now() - max(last_seen_at))::int from public.agent_worker_heartbeats),
    'ultimo_erro', (select last_error from public.agent_worker_heartbeats where last_error is not null order by last_error_at desc nulls last limit 1),
    'ultimo_erro_em', (select max(last_error_at) from public.agent_worker_heartbeats),
    'pendentes', (select count(*)::int from public.job_queue where status = 'pending'),
    'prontos_atrasados', (select count(*)::int from public.job_queue where status = 'pending' and run_after <= now() - interval '2 minutes'),
    'mais_velho_s', (select extract(epoch from now() - min(run_after))::int from public.job_queue where status = 'pending' and run_after <= now()),
    'em_execucao', (select count(*)::int from public.job_queue where status = 'running')
  );
$$;
revoke all on function public.fn_agent_worker_status() from public, anon, authenticated;
grant execute on function public.fn_agent_worker_beat(text, timestamptz, text) to service_role;
grant execute on function public.fn_agent_worker_status() to service_role;
