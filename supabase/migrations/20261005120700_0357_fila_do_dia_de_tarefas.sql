-- Fila do dia: o travamento real das 20 tarefas por responsável.
--
-- A tela já tinha um botão "Fila de hoje (20)" que CALCULAVA as 20 mais
-- urgentes a cada clique — sem trava, concluir uma deixava a tela livre para
-- "puxar" a 21ª. O pedido real foi outro: a tela RECUSA mostrar a 21ª até o
-- dia virar, e a ordem passa a priorizar IMPORTÂNCIA (urgent > high > medium >
-- low) antes de prazo. Isso exige persistência — "as mesmas 20 o dia inteiro"
-- não é algo que uma consulta sem estado consiga garantir sozinha.
--
-- Esta tabela é o COMPROMISSO DO DIA: na primeira vez que alguém abre a fila
-- (por perfil, por dia local da organização), a rota grava aqui o snapshot —
-- até 20 ids, na ordem decidida. Toda leitura seguinte do mesmo dia devolve o
-- MESMO conjunto, não um recálculo; o status de cada tarefa (concluída,
-- cancelada) segue vivo em `crm_tasks`, só a SELEÇÃO fica congelada.

create table if not exists public.crm_task_daily_queue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  responsible_profile_id uuid not null,
  -- Dia LOCAL da organização (não UTC) — "virou o dia" tem que significar
  -- meia-noite de quem trabalha, não meia-noite de Greenwich.
  queue_date date not null,
  task_id uuid not null references public.crm_tasks(id) on delete cascade,
  position smallint not null,
  created_at timestamptz not null default now(),

  constraint crm_task_daily_queue_position_range check (position between 1 and 20),
  constraint crm_task_daily_queue_profile_org_fk
    foreign key (responsible_profile_id, organization_id)
    references public.crm_task_responsibles(id, organization_id)
    on delete cascade,
  constraint crm_task_daily_queue_unique_task
    unique (organization_id, responsible_profile_id, queue_date, task_id),
  constraint crm_task_daily_queue_unique_position
    unique (organization_id, responsible_profile_id, queue_date, position)
);

create index if not exists crm_task_daily_queue_lookup_idx
  on public.crm_task_daily_queue (organization_id, responsible_profile_id, queue_date);

alter table public.crm_task_daily_queue enable row level security;

drop policy if exists crm_task_daily_queue_select on public.crm_task_daily_queue;
create policy crm_task_daily_queue_select on public.crm_task_daily_queue
  for select using (
    organization_id in (select public.fn_user_org_ids())
    or public.fn_is_platform_admin()
  );

-- Escrita é SÓ o servidor materializando o snapshot do dia (piso `agent`,
-- aplicado na rota) — nunca a tela escrevendo a lista à mão. A policy segue a
-- mesma régua de `crm_task_responsibles_write`: qualquer agent+ da org, porque
-- é quem já pode marcar tarefa como feita.
drop policy if exists crm_task_daily_queue_write on public.crm_task_daily_queue;
create policy crm_task_daily_queue_write on public.crm_task_daily_queue
  using (
    public.fn_is_platform_admin()
    or (
      organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'agent')
    )
  )
  with check (
    public.fn_is_platform_admin()
    or (
      organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'agent')
    )
  );

revoke all on public.crm_task_daily_queue from anon;
grant select, insert on public.crm_task_daily_queue to authenticated;
grant all on public.crm_task_daily_queue to service_role;
