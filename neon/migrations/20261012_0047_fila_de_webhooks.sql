-- Fila de reenvio do `call_webhook` (lib/automation/fila-de-webhooks.ts).
-- A entrega que falhou por motivo passageiro (destino fora do ar, timeout, 5xx) vira uma linha
-- aqui e o cron `webhook-retry` tenta de novo com espera crescente (~16 h). Antes, um lead
-- qualificado enquanto o destino estava fora se perdia sem aviso.
-- Leitura: membros da organização. Escrita: só a identidade técnica do servidor.
begin;

create table if not exists public.webhook_delivery_queue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_id uuid,
  event_id uuid,
  url text not null,
  headers jsonb not null default '{}'::jsonb,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_status integer,
  last_error text,
  delivered_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_webhook_delivery_queue_due
  on public.webhook_delivery_queue (next_attempt_at) where status = 'pending';
create index if not exists idx_webhook_delivery_queue_org
  on public.webhook_delivery_queue (organization_id, created_at desc);

drop trigger if exists trg_webhook_delivery_queue_updated_at on public.webhook_delivery_queue;
create trigger trg_webhook_delivery_queue_updated_at before update on public.webhook_delivery_queue
  for each row execute function public.fn_set_updated_at();

alter table public.webhook_delivery_queue enable row level security;
revoke all on public.webhook_delivery_queue from anon;
grant select, insert, update, delete on public.webhook_delivery_queue to authenticated;
grant all on public.webhook_delivery_queue to service_role;

drop policy if exists tenant_select on public.webhook_delivery_queue;
create policy tenant_select on public.webhook_delivery_queue
  for select using (organization_id in (select public.fn_user_org_ids()) or public.fn_is_platform_admin());

drop policy if exists neon_server_service_all on public.webhook_delivery_queue;
create policy neon_server_service_all on public.webhook_delivery_queue
  for all to authenticated
  using (public.fn_neon_service_identity_ok()) with check (public.fn_neon_service_identity_ok());

insert into public.neon_schema_migrations(version,note)
values('20261012_0047_fila_de_webhooks','Fila de reenvio do call_webhook: falha passageira vira linha reenviada pelo cron webhook-retry (~16 h)')
on conflict(version) do update set applied_at=excluded.applied_at,note=excluded.note;
notify pgrst,'reload schema';
commit;
