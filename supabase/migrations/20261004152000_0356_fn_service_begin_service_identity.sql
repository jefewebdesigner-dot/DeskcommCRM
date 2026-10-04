-- 0018: fn_service_begin ganha GRANT para a identidade de serviço (Neon) e
-- passa a exigi-la internamente — quinta ocorrência da mesma causa raiz desta
-- sessão (ver 0012, 0016, 0017): função nasceu só para `service_role`
-- (arquitetura Supabase original), e nesta instalação Neon a identidade
-- técnica (createAdminClient()) sempre se apresenta como `authenticated`
-- (lib/supabase/admin.ts: "role: authenticated"), nunca como `service_role`.
--
-- Bug real medido em produção (PeríciaIA): a automação "Agenda · confirmar
-- reunião agendada" (send_whatsapp_message após appointment.created) e
-- QUALQUER automação/worker que chame beginServiceAtOrigin/ensureConversation
-- (lib/atendimento/origem.ts -> admin.rpc("fn_service_begin", ...)) falhava
-- sempre com `permission denied for function fn_service_begin` (42501) — a
-- migration 0222 revogou EXECUTE de authenticated/anon/public e concedeu só a
-- service_role, que não existe nesta arquitetura.
--
-- Diferente da 0017 (guarda interna barrando quem já tinha EXECUTE): aqui
-- falta o GRANT em si. Conceder puro a `authenticated` abriria uma rota de
-- escrita cross-tenant real — fn_service_begin é security definer, bypassa
-- RLS, e recebe org_id/contact_id como parâmetro cru, sem checar auth.uid()
-- contra a organização. Por isso o conserto soma as duas coisas: concede
-- EXECUTE a authenticated E adiciona a guarda que falta (mesmo padrão da
-- 0017), restaurando a intenção original ("só service_role chama isto") sob
-- o modelo de papel desta instalação.
--
-- Validado em produção: fn_service_begin via identidade de serviço reproduziu
-- "permission denied" (42501) ANTES desta migration, sucesso DEPOIS.

create or replace function public.fn_service_begin(p_org uuid,p_contact uuid,p_session uuid default null,p_observed jsonb default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  c public.conversations;
  sid uuid;
  v_service_identity constant uuid := '713c70ed-4d34-4e91-8d44-f7b1bbc47140';
begin
 if auth.uid() is distinct from v_service_identity then
   raise exception 'service_caller_required' using errcode='42501';
 end if;
 perform public.fn_service_lock(p_org,p_contact);
 if not exists(select 1 from public.contacts where id=p_contact and organization_id=p_org and not is_anonymized and is_merged_into is null) then
  raise exception 'service_contact_not_found' using errcode='P0002'; end if;
 select * into c from public.conversations where organization_id=p_org and contact_id=p_contact and not is_group
  and (p_session is null or channel_session_id=p_session) order by last_message_at desc nulls last,created_at desc limit 1 for no key update;
 if p_observed is not null then
   if p_observed->>'organization_id' is distinct from p_org::text or p_observed->>'contact_id' is distinct from p_contact::text then
     raise exception 'service_scope_mismatch' using errcode='23503'; end if;
   if c.id is null then
     if p_observed->>'absent' is distinct from 'true' then raise exception 'service_stale' using errcode='40001'; end if;
   elsif public.fn_service_boundary(p_org,c.id) is distinct from p_observed then
     raise exception 'service_stale' using errcode='40001';
   end if;
 end if;
 if c.id is not null then
   if c.status in ('closed','resolved','archived') then
     c:=public.fn_service_status(p_org,c.id,'open',c.service_revision);
   end if;
   if exists(select 1 from public.demandas where id=c.current_demanda_id and organization_id=p_org and fechada_em is not null) then
     update public.conversations set service_revision=service_revision+1,current_demanda_id=null,service_started_at=clock_timestamp()
      where id=c.id and organization_id=p_org returning * into c;
   end if;
   if c.service_started_at is null then
     update public.conversations set service_revision=service_revision+1,service_started_at=clock_timestamp()
      where id=c.id and organization_id=p_org returning * into c;
   end if;
   return public.fn_service_boundary(p_org,c.id);
 end if;
 select id into sid from public.channel_sessions where organization_id=p_org and archived_at is null
  and (p_session is null or id=p_session) order by (status='WORKING') desc,created_at limit 1;
 if sid is null then raise exception 'service_channel_not_found' using errcode='P0002'; end if;
 insert into public.conversations(organization_id,contact_id,channel_session_id,status,is_group,channel,service_started_at)
  values(p_org,p_contact,sid,'open',false,'whatsapp',clock_timestamp()) returning * into c;
 return public.fn_service_boundary(p_org,c.id);
end; $$;

revoke execute on function public.fn_service_begin(uuid,uuid,uuid,jsonb) from public, anon;
grant execute on function public.fn_service_begin(uuid,uuid,uuid,jsonb) to authenticated, service_role;
