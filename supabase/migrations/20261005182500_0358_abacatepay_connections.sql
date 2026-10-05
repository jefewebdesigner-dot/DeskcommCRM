-- Conexão direta com a AbacatePay (API real do provedor, não o bridge do
-- admin legado que `billing_export_connections` consome).
--
-- Mesmo molde de `billing_export_connections` (migration 0344) e mesmo motivo
-- do bloqueio total: o segredo é lido/escrito só por `lib/payment-providers/
-- abacatepay/config.ts`, via conexão direta (`pg.Pool` + `DATABASE_URL`), com
-- o próprio envelope AES-256-GCM cuidando do sigilo — nunca pelo PostgREST,
-- então `authenticated`/`anon` não têm (nem precisam de) nenhuma policy aqui.
create table if not exists public.abacatepay_connections (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  encrypted_api_key text not null,
  store_id text,
  store_name text,
  updated_at timestamptz not null default now()
);

alter table public.abacatepay_connections enable row level security;
revoke all on public.abacatepay_connections from public, anon, authenticated;
grant select, insert, update, delete on public.abacatepay_connections to service_role;
