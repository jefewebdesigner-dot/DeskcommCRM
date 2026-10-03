-- 0016: fn_google_projection_stamp isenta a identidade de serviço da guarda de auth.uid()
--
-- Bug real medido em produção (PeríciaIA): o push de um compromisso real para
-- o Google Calendar falhava sempre com "google_metadata_private" (42501),
-- levantado pela trigger `fn_google_projection_stamp` em
-- `calendar_appointments`. Mesma causa raiz da migration 0012
-- (fn_emit_message_event): a guarda assume que escrita "interna/do worker"
-- tem `auth.uid() IS NULL`, e isso é falso nesta arquitetura Neon — toda
-- escrita de produção passa por `createAdminClient()` (identidade de
-- serviço, auth.uid() SEMPRE preenchido), então a trigger nunca distingue
-- "o sync-executor atualizando metadado de sincronização" de "um usuário
-- escrevendo direto na tabela" — e bloqueia os DOIS.
--
-- Diferente da 0012 (onde a saída foi tirar o emissor da RPC pública
-- guardada), aqui a trigger carrega regra de negócio real e intrincada
-- (resolução de conflito local×Google, revisão, etag) que não dá para
-- contornar — teria que ser preservada byte a byte. A correção é cirúrgica:
-- as duas guardas (`raise exception 'google_metadata_private'`) passam a
-- isentar explicitamente a identidade de serviço conhecida desta instalação
-- (`713c70ed-4d34-4e91-8d44-f7b1bbc47140`, já usada em todas as políticas
-- `service_identity_bypass` desta base) — mesmo padrão já em vigor em RLS,
-- agora replicado na trigger. Um usuário real (humano, com seu próprio
-- auth.uid()) continua barrado de escrever direto nesses campos; só a
-- identidade de serviço, que é quem o sync-executor usa de fato, passa.
--
-- Validado em produção: reconcileAppointment rodado diretamente contra o
-- compromisso de teste 307af523-3aba-412a-be07-866b8ac28f19 — reproduzido o
-- erro ANTES desta migration, confirmado sucesso DEPOIS.

create or replace function public.fn_google_projection_stamp()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare changed boolean; inbound boolean; decision boolean; redacted boolean;
  v_service_identity constant uuid := '713c70ed-4d34-4e91-8d44-f7b1bbc47140';
begin
 redacted:=new.contact_id is not null and exists(select 1 from public.contacts where organization_id=new.organization_id and id=new.contact_id and is_anonymized);
 if redacted then
  new.google_base_projection:=null;new.google_conflict:=null;new.google_pending_write:=null;new.google_claim_token:=null;new.google_claim_until:=null;new.google_etag:=null;new.guest_email:=null;
  if tg_op='UPDATE' then new.google_claim_epoch:=old.google_claim_epoch+1;new.google_local_revision:=old.google_local_revision;new.google_synced_local_revision:=old.google_local_revision;end if;
  return new;
 end if;
 if tg_op='INSERT' then
  new.google_local_revision:=1;new.google_synced_local_revision:=0;
  if auth.uid() is not null and auth.uid() <> v_service_identity then
   new.google_base_projection:=null;new.google_etag:=null;new.google_pending_write:=null;new.google_conflict:=null;
   new.google_claim_token:=null;new.google_claim_epoch:=0;new.google_claim_until:=null;
   new.google_connection_id:=null;new.google_calendar_id:=null;new.google_event_id:=null;
  end if;
  return new;
 end if;
 decision:=auth.uid()=old.owner_user_id and public.fn_role_at_least(new.organization_id,'agent') and public.fn_support_write_allowed(new.organization_id)
  and old.google_conflict is not null and new.google_conflict-'resolution'=old.google_conflict-'resolution'
  and new.google_conflict->'resolution'->>'actor_id'=auth.uid()::text
  and new.google_conflict->'resolution'->>'choice' in ('google','local','preserve_remote')
  and old.google_conflict->>'revision'=old.revision::text and old.google_conflict->>'local_revision'=old.google_local_revision::text
  and old.google_conflict->>'etag' is not distinct from old.google_etag;
 if auth.uid() is not null and auth.uid() <> v_service_identity and (row(new.google_synced_at,new.google_sync_error) is distinct from row(old.google_synced_at,old.google_sync_error)
  or (new.google_next_attempt_at is distinct from old.google_next_attempt_at and not coalesce(auth.uid()=old.owner_user_id and public.fn_role_at_least(new.organization_id,'agent') and public.fn_support_write_allowed(new.organization_id)
    and new.google_next_attempt_at<=clock_timestamp() and (old.google_conflict is null or decision),false))) then
  raise exception 'google_metadata_private' using errcode='42501';end if;
 if auth.uid() is not null and auth.uid() <> v_service_identity and ((new.google_conflict is distinct from old.google_conflict and not coalesce(decision,false)) or row(new.google_base_projection,new.google_pending_write,new.google_claim_token,new.google_claim_epoch,new.google_claim_until,new.google_synced_local_revision,new.google_etag,new.google_connection_id,new.google_calendar_id,new.google_event_id)
  is distinct from row(old.google_base_projection,old.google_pending_write,old.google_claim_token,old.google_claim_epoch,old.google_claim_until,old.google_synced_local_revision,old.google_etag,old.google_connection_id,old.google_calendar_id,old.google_event_id)) then
  raise exception 'google_metadata_private' using errcode='42501';
 end if;
 changed:=row(new.starts_at,new.ends_at,new.time_zone,new.status='cancelled',new.title,new.description,new.location_kind,new.location_details,new.guest_email)
  is distinct from row(old.starts_at,old.ends_at,old.time_zone,old.status='cancelled',old.title,old.description,old.location_kind,old.location_details,old.guest_email);
 -- Única entrada que modifica base e domínio juntos é o núcleo service-only.
 -- Não há GUC ou flag no body público que suprima revisão.
 inbound:=row(new.title,new.description,new.location_kind,new.location_details,new.guest_email) is not distinct from row(old.title,old.description,old.location_kind,old.location_details,old.guest_email) and (auth.uid() is null or auth.uid() = v_service_identity) and new.google_base_projection is distinct from old.google_base_projection
  and (new.google_base_projection->'shared'->>'starts_at')::timestamptz=new.starts_at
  and (new.google_base_projection->'shared'->>'ends_at')::timestamptz=new.ends_at
  and new.google_base_projection->'shared'->>'time_zone'=new.time_zone
  and (new.google_base_projection->'shared'->>'cancelled')::boolean=(new.status='cancelled');
 new.google_local_revision:=old.google_local_revision+case when changed and not coalesce(inbound,false) then 1 else 0 end;
 if changed then new.google_next_attempt_at:=now(); end if;
 return new;
end;$function$;
