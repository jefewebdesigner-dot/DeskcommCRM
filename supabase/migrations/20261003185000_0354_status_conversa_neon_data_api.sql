-- 0354 — status de conversa volta a ser executável pelo usuário autenticado.
--
-- Após a migração do runtime para Neon Data API, o "admin client" passou a usar
-- uma identidade técnica autenticada. A RPC fn_service_status continuava com
-- EXECUTE apenas para service_role, então PATCH/Fechar/Arquivar recebiam 42501
-- antes de qualquer mudança de estado.
--
-- A função é SECURITY DEFINER, portanto NÃO basta conceder EXECUTE sem guarda.
-- A autorização passa a morar também no banco: sessão de usuário precisa ser
-- agent+ da organização e respeitar a trava de suporte. Chamadas internas sem
-- JWT (service_role/worker SQL) preservam o comportamento histórico.
create or replace function public.fn_service_status(
  p_org uuid,
  p_conversation uuid,
  p_status text,
  p_expected bigint default null
)
returns public.conversations
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.conversations;
  terminal boolean;
  pre_contact uuid;
begin
  if auth.uid() is not null
     and (
       not public.fn_role_at_least(p_org, 'agent')
       or not public.fn_support_write_allowed(p_org)
     ) then
    raise exception 'service_status_forbidden' using errcode='42501';
  end if;

  if p_status not in ('closed','resolved','archived','open','pending','ai_handling','claimed') then
    raise exception 'invalid_status' using errcode='22023';
  end if;

  select * into c
    from public.conversations
   where id = p_conversation
     and organization_id = p_org;

  if not found then
    raise exception 'service_not_found' using errcode='P0002';
  end if;

  pre_contact := c.contact_id;
  perform public.fn_service_lock(p_org, c.contact_id);

  select * into c
    from public.conversations
   where id = p_conversation
     and organization_id = p_org
   for no key update;

  if c.contact_id is distinct from pre_contact then
    raise exception 'service_contact_changed' using errcode='40001';
  end if;

  if p_expected is not null and c.service_revision <> p_expected then
    raise exception 'service_stale' using errcode='40001';
  end if;

  if c.status = p_status then
    return c;
  end if;

  terminal := p_status in ('closed','resolved','archived');

  update public.conversations
     set status = p_status,
         status_changed_at = clock_timestamp(),
         service_revision = service_revision + case
           when terminal or c.status in ('closed','resolved','archived') then 1
           else 0
         end,
         service_closed_at = case
           when terminal then clock_timestamp()
           else service_closed_at
         end,
         service_started_at = case
           when c.status in ('closed','resolved','archived') and not terminal
             then clock_timestamp()
           else service_started_at
         end,
         bot_silenced_until = case
           when terminal and last_handoff_at is null then null
           else bot_silenced_until
         end,
         current_demanda_id = case
           when c.status in ('closed','resolved','archived') and not terminal
             then null
           else current_demanda_id
         end
   where id = c.id
     and organization_id = p_org
   returning * into c;

  if terminal then
    update public.demandas
       set proximo_passo = coalesce(
         proximo_passo,
         'Revisar atendimento e registrar o desfecho da demanda'
       )
     where organization_id = p_org
       and id = c.current_demanda_id
       and fechada_em is null;
  end if;

  return c;
end;
$$;

revoke execute on function public.fn_service_status(uuid,uuid,text,bigint)
  from public, anon;
grant execute on function public.fn_service_status(uuid,uuid,text,bigint)
  to authenticated, service_role;
