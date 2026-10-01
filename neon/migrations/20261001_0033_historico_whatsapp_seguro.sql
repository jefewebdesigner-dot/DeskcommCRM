-- Histórico do WhatsApp: persistir passado sem executar o presente.
--
-- Mensagens de backfill levam metadata.history_import=true. Elas precisam
-- aparecer no Inbox e alimentar contexto, mas NÃO podem abrir demanda, rotear
-- atendimento, emitir automação ou incrementar revisão/unread como se tivessem
-- chegado agora.

begin;

create or replace function public.fn_message_service_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.metadata->>'history_import','false') = 'true' then
    return new;
  end if;
  if new.direction='inbound' and new.contact_id is not null then
    perform public.fn_service_lock(new.organization_id,new.contact_id);
  end if;
  return new;
end;
$$;

create or replace function public.fn_demanda_abre_no_inbound()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.metadata->>'history_import','false') = 'true' then
    return new;
  end if;
  perform public.fn_service_inbound(new.id);
  return new;
end;
$$;

create or replace function public.fn_reply_inbound_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.metadata->>'history_import','false') = 'true' then
    return new;
  end if;
  if new.direction='inbound' then
    update public.conversations
       set reply_context_revision=reply_context_revision+1
     where organization_id=new.organization_id
       and id=new.conversation_id
       and contact_id=new.contact_id;
  end if;
  return new;
end;
$$;

create or replace function public.fn_emit_message_event()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare v_event text;
begin
  if coalesce(new.metadata->>'history_import','false') = 'true' then
    return new;
  end if;

  if new.direction='inbound' then
    v_event := 'message.received';
  else
    v_event := case new.status
      when 'sending' then 'message.sending'
      when 'sent' then 'message.sent'
      when 'failed' then 'message.failed'
      else 'message.outbound'
    end;
  end if;

  perform public.fn_log_event(
    new.organization_id,
    v_event,
    jsonb_build_object(
      'message_id',new.id,
      'conversation_id',new.conversation_id,
      'contact_id',new.contact_id,
      'direction',new.direction,
      'type',new.type,
      'status',new.status,
      'external_id',new.external_id,
      'channel_session_id',new.channel_session_id,
      'body_preview',left(new.body,280)
    )
  );
  return new;
end;
$$;

create or replace function public.fn_upsert_wa_conversation_history(
  p_org uuid,
  p_contact uuid,
  p_session uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if not public.fn_support_write_allowed(p_org) then
    raise exception 'history_import_forbidden' using errcode='42501';
  end if;

  if not exists (
    select 1 from public.contacts
     where id=p_contact and organization_id=p_org
  ) or not exists (
    select 1 from public.channel_sessions
     where id=p_session and organization_id=p_org
  ) then
    raise exception 'history_import_scope_mismatch' using errcode='23503';
  end if;

  select id into v_id
    from public.conversations
   where organization_id=p_org
     and contact_id=p_contact
     and channel_session_id=p_session
     and is_group=false
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.conversations(
    organization_id,contact_id,channel_session_id,channel,status,is_group,
    unread_count_for_assignee,metadata,service_closed_at
  )
  values(
    p_org,p_contact,p_session,'whatsapp','closed',false,0,
    '{"history_import":true}'::jsonb,clock_timestamp()
  )
  on conflict (organization_id,contact_id,channel_session_id)
    where is_group=false
  do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
      from public.conversations
     where organization_id=p_org
       and contact_id=p_contact
       and channel_session_id=p_session
       and is_group=false
     limit 1;
  end if;

  return v_id;
end;
$$;

create or replace function public.fn_mark_conversation_history(
  p_conv uuid,
  p_direction text,
  p_preview text,
  p_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare c public.conversations;
begin
  select * into c from public.conversations where id=p_conv for update;
  if not found then return; end if;

  if not public.fn_support_write_allowed(c.organization_id) then
    raise exception 'history_import_forbidden' using errcode='42501';
  end if;

  update public.conversations
     set last_message_at=greatest(last_message_at,p_at),
         last_message_preview=case
           when last_message_at is null or p_at>=last_message_at then p_preview
           else last_message_preview
         end,
         last_inbound_at=case
           when p_direction='inbound' then greatest(last_inbound_at,p_at)
           else last_inbound_at
         end,
         last_outbound_at=case
           when p_direction='outbound' then greatest(last_outbound_at,p_at)
           else last_outbound_at
         end,
         service_closed_at=case
           when status='closed' and coalesce(metadata->>'history_import','false')='true'
             then greatest(coalesce(service_closed_at,p_at),p_at)
           else service_closed_at
         end
   where id=c.id and organization_id=c.organization_id;

  update public.contacts
     set last_activity_at=greatest(last_activity_at,p_at)
   where id=c.contact_id and organization_id=c.organization_id;
end;
$$;

revoke all on function public.fn_upsert_wa_conversation_history(uuid,uuid,uuid)
  from public,anon;
revoke all on function public.fn_mark_conversation_history(uuid,text,text,timestamptz)
  from public,anon;
grant execute on function public.fn_upsert_wa_conversation_history(uuid,uuid,uuid)
  to authenticated,service_role;
grant execute on function public.fn_mark_conversation_history(uuid,text,text,timestamptz)
  to authenticated,service_role;

insert into public.neon_schema_migrations(version,note)
values(
 '20261001_0033_historico_whatsapp_seguro',
 'Backfill WhatsApp persiste historico sem eventos operacionais e cria conversas fechadas'
)
on conflict(version) do update
set applied_at=excluded.applied_at,note=excluded.note;

notify pgrst, 'reload schema';
commit;
