-- 0355 — Inbox operacional: Lead / Cliente / Suporte.
--
-- A lista do Inbox precisa responder à pergunta de quem atende, não à topologia
-- interna (fila/minhas/todas/IA). A categoria é persistida na conversa para ser
-- filtrável/paginável no banco — filtrar depois da página de 50 voltaria a criar
-- listas curtas e "carregar mais" enganoso.
--
-- Regra:
--   suporte > cliente > lead
--   cliente = fato de cliente já reconhecido OU card operacional aberto em
--             Pós-vendas/Retenção
--   suporte = cliente com demanda de atendimento ativa OU card aberto no funil
--             operacional de Suporte
--   lead = o restante
--
-- Isso evita duas mentiras observadas na base real do PeríciaIA: nem todo cliente
-- ativo já tem `client_recognized_at`, e exigir card manual de Suporte deixaria a
-- aba vazia mesmo quando um cliente já escreveu e abriu uma demanda.
-- O suporte vence cliente de propósito: "cliente" é QUEM a pessoa é; "suporte"
-- é o trabalho que ela está pedindo agora.

alter table public.conversations
  add column if not exists inbox_category text not null default 'lead';

alter table public.conversations
  drop constraint if exists conversations_inbox_category_check;
alter table public.conversations
  add constraint conversations_inbox_category_check
  check (inbox_category in ('lead','client','support'));

comment on column public.conversations.inbox_category is
  'Categoria operacional do Inbox: support para cliente em atendimento ativo ou card de suporte; client para relação pós-venda/retenção/reconhecida; lead para o restante.';

create or replace function public.fn_inbox_category(
  p_org uuid,
  p_contact uuid,
  p_demanda uuid
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with fatos as (
    select
      exists (
        select 1
        from public.contacts c
        where c.id = p_contact
          and c.organization_id = p_org
          and c.client_recognized_at is not null
      )
      or exists (
        select 1
        from public.crm_leads l
        join public.crm_pipelines p
          on p.id = l.pipeline_id
         and p.organization_id = l.organization_id
        where l.organization_id = p_org
          and l.contact_id = p_contact
          and l.status = 'open'
          and not p.is_archived
          and coalesce(p.settings ->> 'operational_kind', '') in ('post_sales','retention')
      ) as cliente,
      exists (
        select 1
        from public.crm_leads l
        join public.crm_pipelines p
          on p.id = l.pipeline_id
         and p.organization_id = l.organization_id
        where l.organization_id = p_org
          and l.contact_id = p_contact
          and l.status = 'open'
          and not p.is_archived
          and coalesce(p.settings ->> 'operational_kind', '') = 'support'
      ) as card_suporte
  )
  select case
    when card_suporte then 'support'
    when cliente and p_demanda is not null then 'support'
    when cliente then 'client'
    else 'lead'
  end
  from fatos;
$$;

revoke all on function public.fn_inbox_category(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.fn_inbox_category(uuid,uuid,uuid) to service_role;

-- Escrita canônica quando nasce uma conversa ou muda de contato/tenant.
create or replace function public.fn_inbox_category_on_conversation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.inbox_category := public.fn_inbox_category(new.organization_id, new.contact_id, new.current_demanda_id);
  return new;
end;
$$;

revoke all on function public.fn_inbox_category_on_conversation() from public, anon, authenticated;

drop trigger if exists trg_inbox_category_on_conversation on public.conversations;
create trigger trg_inbox_category_on_conversation
  before insert or update of organization_id, contact_id, current_demanda_id, inbox_category
  on public.conversations
  for each row execute function public.fn_inbox_category_on_conversation();

-- Quando o contato é reconhecido como cliente, todas as conversas dele passam a
-- refletir isso — exceto as que continuam em suporte, porque a função recalcula.
create or replace function public.fn_inbox_category_on_contact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.client_recognized_at is distinct from old.client_recognized_at then
    update public.conversations c
       set inbox_category = public.fn_inbox_category(c.organization_id, c.contact_id, c.current_demanda_id)
     where c.organization_id = new.organization_id
       and c.contact_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.fn_inbox_category_on_contact() from public, anon, authenticated;

drop trigger if exists trg_inbox_category_on_contact on public.contacts;
create trigger trg_inbox_category_on_contact
  after update of client_recognized_at
  on public.contacts
  for each row execute function public.fn_inbox_category_on_contact();

-- Entrar/sair/mover um card de suporte muda a prioridade operacional da conversa.
create or replace function public.fn_inbox_category_reclassify_contact(
  p_org uuid,
  p_contact uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_org is null or p_contact is null then return; end if;
  update public.conversations c
     set inbox_category = public.fn_inbox_category(c.organization_id, c.contact_id, c.current_demanda_id)
   where c.organization_id = p_org
     and c.contact_id = p_contact;
end;
$$;

revoke all on function public.fn_inbox_category_reclassify_contact(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.fn_inbox_category_reclassify_contact(uuid,uuid)
  to service_role;

create or replace function public.fn_inbox_category_on_lead()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform public.fn_inbox_category_reclassify_contact(old.organization_id, old.contact_id);
    return old;
  end if;

  if tg_op = 'INSERT' then
    perform public.fn_inbox_category_reclassify_contact(new.organization_id, new.contact_id);
    return new;
  end if;

  if row(new.organization_id, new.contact_id, new.pipeline_id, new.status)
     is distinct from
     row(old.organization_id, old.contact_id, old.pipeline_id, old.status) then
    perform public.fn_inbox_category_reclassify_contact(old.organization_id, old.contact_id);
    perform public.fn_inbox_category_reclassify_contact(new.organization_id, new.contact_id);
  end if;
  return new;
end;
$$;

revoke all on function public.fn_inbox_category_on_lead() from public, anon, authenticated;

drop trigger if exists trg_inbox_category_on_lead on public.crm_leads;
create trigger trg_inbox_category_on_lead
  after insert or delete or update of organization_id, contact_id, pipeline_id, status
  on public.crm_leads
  for each row execute function public.fn_inbox_category_on_lead();

-- Se o administrador muda a natureza operacional de um funil, os cards daquele
-- funil precisam reclassificar as conversas dos contatos sem esperar mensagem nova.
create or replace function public.fn_inbox_category_on_pipeline()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(new.settings ->> 'operational_kind', '')
     is distinct from
     coalesce(old.settings ->> 'operational_kind', '')
     or new.is_archived is distinct from old.is_archived then
    update public.conversations c
       set inbox_category = public.fn_inbox_category(c.organization_id, c.contact_id, c.current_demanda_id)
     where c.organization_id = new.organization_id
       and exists (
         select 1
         from public.crm_leads l
         where l.organization_id = new.organization_id
           and l.pipeline_id = new.id
           and l.contact_id = c.contact_id
       );
  end if;
  return new;
end;
$$;

revoke all on function public.fn_inbox_category_on_pipeline() from public, anon, authenticated;

drop trigger if exists trg_inbox_category_on_pipeline on public.crm_pipelines;
create trigger trg_inbox_category_on_pipeline
  after update of settings, is_archived
  on public.crm_pipelines
  for each row execute function public.fn_inbox_category_on_pipeline();

-- Backfill com a mesma régua dos gatilhos.
update public.conversations c
   set inbox_category = public.fn_inbox_category(c.organization_id, c.contact_id, c.current_demanda_id)
 where c.inbox_category is distinct from public.fn_inbox_category(c.organization_id, c.contact_id, c.current_demanda_id);

create index if not exists conversations_inbox_category_recent_idx
  on public.conversations (organization_id, inbox_category, last_message_at desc, id desc);

-- Limpa a assinatura da primeira iteração da migration caso ela tenha sido
-- aplicada manualmente antes desta versão final.
drop function if exists public.fn_inbox_category(uuid,uuid);

notify pgrst, 'reload schema';
