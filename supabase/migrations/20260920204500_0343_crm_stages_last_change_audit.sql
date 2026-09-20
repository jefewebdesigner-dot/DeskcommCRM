-- Compatibilidade do Business Blueprint / Sales Twin.
-- O código já grava estes campos em crm_stages; instalações cujo banco foi
-- criado antes dessa auditoria não podem falhar ao aplicar um Blueprint.
alter table public.crm_stages
  add column if not exists last_change_actor_kind text,
  add column if not exists last_change_at timestamptz;

comment on column public.crm_stages.last_change_actor_kind is
  'Origem da última alteração estrutural da etapa (ex.: sales_twin).';

comment on column public.crm_stages.last_change_at is
  'Instante da última alteração estrutural registrada por integração.';
