-- Neon — RPCs canônicas do webhook aceitam a identidade técnica server
-- SOMENTE para a mesma organização. A ACL authenticated sozinha nunca basta:
-- cada função revalida auth.uid() em neon_service_identities.

begin;

CREATE OR REPLACE FUNCTION public.fn_upsert_wa_contact(p_org uuid, p_kind text, p_phone text, p_lid text, p_chat_id text, p_notify text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_conflito text;
  v_lid text := nullif(regexp_replace(coalesce(p_lid, ''), '@.*$', ''), '');
  v_phone text := nullif(p_phone, '');
  v_digits text;
  v_alt text;
begin

  if not (
    session_user = 'service_role'
    or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role','') = 'service_role'
    or (
      auth.uid() is not null
      and exists (
        select 1 from public.neon_service_identities s
         where s.user_id = auth.uid()
           and s.organization_id = p_org
           and s.active
           and s.kind = 'server'
      )
    )
  ) then
    raise exception 'wa_server_identity_required' using errcode='42501';
  end if;
  -- Celular BR de 12 dígitos (local 6–9) ganha o nono. A grafia sem o 9 fica
  -- em v_alt só para a BUSCA — não se escreve mais.
  if v_phone is not null then
    v_digits := regexp_replace(v_phone, '\D', '', 'g');
    if v_digits ~ '^55[1-9][0-9][6-9][0-9]{7}$' then
      v_alt := '+' || v_digits;
      v_phone := '+55' || substring(v_digits from 3 for 2) || '9' || substring(v_digits from 5);
    elsif v_digits ~ '^55[1-9][0-9]9[6-9][0-9]{7}$' then
      v_phone := '+' || v_digits;
      v_alt := '+55' || substring(v_digits from 3 for 2) || substring(v_digits from 6);
    end if;
  end if;

  if v_lid is not null then
    select id into v_id from public.contacts
     where organization_id = p_org and wa_lid = v_lid and is_merged_into is null
     limit 1;
  end if;

  if v_id is null and v_phone is not null then
    select id into v_id from public.contacts
     where organization_id = p_org and is_merged_into is null
       and phone_number in (v_phone, v_alt)
     order by case when phone_number = v_phone then 0 else 1 end
     limit 1;
  end if;

  if v_id is not null and v_phone is not null and exists (
    select 1 from public.contacts
     where organization_id = p_org and phone_number = v_phone
       and is_merged_into is null and id <> v_id
  ) then
    v_conflito := v_phone;
    v_phone := null;
  end if;

  if v_id is not null then
    update public.contacts set
      -- Promove 12→13 quando é a MESMA pessoa e o canônico está livre.
      -- Outro número (pessoa diferente) continua intocável.
      phone_number = case
        when v_phone is not null and (phone_number is null or phone_number = v_alt) then v_phone
        else phone_number
      end,
      display_name = coalesce(display_name, nullif(p_notify, '')),
      source_metadata = source_metadata
        || case when v_lid is not null then jsonb_build_object('waha_lid', v_lid) else '{}'::jsonb end
        || case when p_chat_id is not null then jsonb_build_object('waha_chat_id', p_chat_id) else '{}'::jsonb end
        || case when nullif(p_notify, '') is not null then jsonb_build_object('notify_name', p_notify) else '{}'::jsonb end
        || case when v_conflito is not null then jsonb_build_object('telefone_em_conflito', v_conflito) else '{}'::jsonb end,
      updated_at = now()
    where id = v_id;
    return v_id;
  end if;

  begin
    insert into public.contacts (organization_id, phone_number, source, consent, tags, source_metadata, display_name)
    values (p_org, v_phone, 'whatsapp', '{}'::jsonb, '{}'::text[],
      case when v_lid is not null
        then jsonb_build_object('waha_lid', v_lid, 'waha_chat_id', p_chat_id, 'notify_name', nullif(p_notify, ''))
        else jsonb_build_object('waha_chat_id', p_chat_id, 'notify_name', nullif(p_notify, '')) end,
      nullif(p_notify, ''))
    returning id into v_id;
    return v_id;
  exception when unique_violation then
    select id into v_id from public.contacts
     where organization_id = p_org and is_merged_into is null
       and (
         (v_phone is not null and phone_number = v_phone)
         or (v_alt is not null and phone_number = v_alt)
         or (v_lid is not null and wa_lid = v_lid)
       )
     order by case when phone_number = v_phone then 0 else 1 end
     limit 1;
    return v_id;
  end;
end; $function$;

CREATE OR REPLACE FUNCTION public.fn_upsert_wa_conversation(p_org uuid, p_contact uuid, p_session uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin

  if not (
    session_user = 'service_role'
    or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role','') = 'service_role'
    or (
      auth.uid() is not null
      and exists (
        select 1 from public.neon_service_identities s
         where s.user_id = auth.uid()
           and s.organization_id = p_org
           and s.active
           and s.kind = 'server'
      )
    )
  ) then
    raise exception 'wa_server_identity_required' using errcode='42501';
  end if;
  insert into public.conversations (organization_id, contact_id, channel_session_id, channel, status, is_group, unread_count_for_assignee, metadata)
  values (p_org, p_contact, p_session, 'whatsapp', 'open', false, 0, '{}'::jsonb)
  on conflict (organization_id, contact_id, channel_session_id) where is_group = false
  do update set updated_at = now()
  returning id into v_id;
  return v_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.fn_mark_conversation_message(p_conv uuid, p_direction text, p_preview text, p_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.conversations; pre_contact uuid;
begin
 select * into c from public.conversations where id=p_conv;
 if not found then return; end if;
  if not (
    session_user = 'service_role'
    or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role','') = 'service_role'
    or (
      auth.uid() is not null
      and exists (
        select 1 from public.neon_service_identities s
         where s.user_id = auth.uid()
           and s.organization_id = c.organization_id
           and s.active
           and s.kind = 'server'
      )
    )
  ) then
    raise exception 'wa_server_identity_required' using errcode='42501';
  end if;

 pre_contact:=c.contact_id;
 perform public.fn_service_lock(c.organization_id,c.contact_id);
 select * into c from public.conversations where id=p_conv for no key update;
 if c.contact_id is distinct from pre_contact then raise exception 'service_contact_changed' using errcode='40001'; end if;
 if p_direction='inbound' and p_at<=c.service_closed_at then return; end if;
 update public.conversations set
  last_message_at=greatest(last_message_at,p_at),
  last_message_preview=case when last_message_at is null or p_at>=last_message_at then p_preview else last_message_preview end,
  last_inbound_at=case when p_direction='inbound' then greatest(last_inbound_at,p_at) else last_inbound_at end,
  last_outbound_at=case when p_direction='outbound' then greatest(last_outbound_at,p_at) else last_outbound_at end,
  unread_count_for_assignee=case when p_direction='inbound' then unread_count_for_assignee+1 when p_direction='outbound' then 0 else unread_count_for_assignee end,
  -- A régua da Fila (issue #990). Inbound, na ordem: (1) mensagem ATRASADA
  -- (escrita antes da última resposta) já está respondida e não é espera —
  -- mantém o que havia; (2) a espera guardada é de uma mensagem SEM RESPOSTA
  -- deste atendimento — o cliente insistiu, e fica o começo da espera, o mais
  -- ANTIGO dos dois; (3) não havia espera (tudo respondido) ou ela é de um
  -- atendimento já encerrado — a espera de agora começa nesta mensagem. No
  -- outbound: resposta anterior à espera guardada não a responde (fora de
  -- ordem, mantém); qualquer outra responde tudo até aqui e a coluna volta ao
  -- last_inbound_at — "não há mensagem sem resposta".
  awaiting_since=case
    when p_direction='inbound' then
      case
        when p_at<=coalesce(c.last_outbound_at,'-infinity'::timestamptz) then
          coalesce(c.awaiting_since,greatest(coalesce(c.last_inbound_at,'-infinity'::timestamptz),p_at))
        when c.awaiting_since>coalesce(c.last_outbound_at,'-infinity'::timestamptz)
         and c.awaiting_since>coalesce(c.service_closed_at,'-infinity'::timestamptz) then
          least(c.awaiting_since,p_at)
        else p_at
      end
    else
      case
        when c.awaiting_since is not null and p_at<c.awaiting_since then c.awaiting_since
        else c.last_inbound_at
      end
  end
 where id=p_conv and organization_id=c.organization_id;
 update public.contacts set last_activity_at=greatest(last_activity_at,p_at)
 where id=c.contact_id and organization_id=c.organization_id;
end; $function$;

revoke execute on function public.fn_upsert_wa_contact(uuid,text,text,text,text,text) from public,anon;
revoke execute on function public.fn_upsert_wa_conversation(uuid,uuid,uuid) from public,anon;
revoke execute on function public.fn_mark_conversation_message(uuid,text,text,timestamptz) from public,anon;
grant execute on function public.fn_upsert_wa_contact(uuid,text,text,text,text,text) to authenticated,service_role;
grant execute on function public.fn_upsert_wa_conversation(uuid,uuid,uuid) to authenticated,service_role;
grant execute on function public.fn_mark_conversation_message(uuid,text,text,timestamptz) to authenticated,service_role;

insert into public.neon_schema_migrations(version,note)
values('20261001_0034_waha_rpc_identidade_tecnica','RPCs WAHA canônicas aceitam identidade técnica server apenas da mesma organização')
on conflict(version) do update set applied_at=excluded.applied_at,note=excluded.note;
notify pgrst, 'reload schema';
commit;
