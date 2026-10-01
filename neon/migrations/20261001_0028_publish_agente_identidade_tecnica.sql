-- Neon — publicação de agente pela identidade técnica escopada à organização.
--
-- No Supabase, o admin client usa service_role. No Neon, createAdminClient usa um
-- JWT técnico com role authenticated; sem esta adaptação a própria rota de
-- publicação morre com permission denied. O grant a authenticated só entra junto
-- do guard abaixo, que exige admin humano da org OU identidade técnica vinculada
-- à MESMA organização.

begin;

CREATE OR REPLACE FUNCTION public.fn_publish_ai_agent_version(p_org_id uuid, p_agent_id uuid, p_version_id uuid, p_platform_credential_verified boolean, p_expected_provenance text)
 RETURNS TABLE(agent_id uuid, version_id uuid, previous_version_id uuid, published_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_agent record;
  v_version record;
  v_credential record;
  v_session record;
  v_model_count integer;
  v_previous_version_id uuid;
  v_published_at timestamptz := now();
begin
  if not (
    session_user = 'service_role'
    or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
    or (
      auth.uid() is not null
      and exists (
        select 1 from public.neon_service_identities s
        where s.user_id = auth.uid()
          and s.organization_id = p_org_id
          and s.active
          and s.kind = 'server'
      )
    )
    or (auth.uid() is not null and public.fn_role_at_least(p_org_id, 'admin'))
  ) then
    raise exception 'publish_forbidden' using errcode = '42501';
  end if;

  select a.id, a.organization_id, a.published_version_id, a.archived_at
    into v_agent
  from public.ai_agents a
  where a.id = p_agent_id
  for update;

  if not found then
    raise exception 'agent_not_found' using errcode = 'P0001';
  end if;
  if v_agent.organization_id <> p_org_id then
    raise exception 'agent_not_found' using errcode = 'P0001';
  end if;
  if v_agent.archived_at is not null then
    raise exception 'agent_archived' using errcode = 'P0001';
  end if;

  select v.id, v.organization_id, v.agent_id, v.status, v.provider, v.model,
         v.credential_id, v.channel_session_id, v.provisioning_origin
    into v_version
  from public.ai_agent_versions v
  where v.id = p_version_id
  for update;

  if not found then
    raise exception 'version_not_found' using errcode = 'P0001';
  end if;
  if v_version.agent_id <> p_agent_id or v_version.organization_id <> p_org_id then
    raise exception 'version_not_found' using errcode = 'P0001';
  end if;
  if p_expected_provenance is not null and (
    p_expected_provenance not in('onboarding','legacy_reconciliation') or
    v_version.provisioning_origin is distinct from p_expected_provenance or
    (select count(*) from public.ai_agent_versions own_version where own_version.organization_id=p_org_id and own_version.agent_id=p_agent_id)<>1
  ) then raise exception 'existing_version_requires_review' using errcode='P0001';end if;
  if v_version.status not in ('draft', 'superseded') then
    raise exception 'version_invalid_state' using errcode = 'P0001';
  end if;

  if v_version.credential_id is null and p_platform_credential_verified is not true then
    raise exception 'credential_missing' using errcode = 'P0001';
  end if;

  if v_version.credential_id is not null then
  select c.id, c.organization_id, c.provider, c.is_active, c.validated_at
    into v_credential
  from public.ai_provider_credentials c
  where c.id = v_version.credential_id;

  if not found or v_credential.organization_id <> p_org_id then
    raise exception 'credential_not_found' using errcode = 'P0001';
  end if;
  if not v_credential.is_active then
    raise exception 'credential_inactive' using errcode = 'P0001';
  end if;
  if v_credential.validated_at is null then
    raise exception 'credential_not_validated' using errcode = 'P0001';
  end if;
  if v_credential.provider <> v_version.provider then
    raise exception 'credential_provider_mismatch' using errcode = 'P0001';
  end if;

  end if;

  select s.id, s.organization_id, s.status
    into v_session
  from public.channel_sessions s
  where s.id = v_version.channel_session_id;

  if not found or v_session.organization_id <> p_org_id then
    raise exception 'channel_session_not_found' using errcode = 'P0001';
  end if;
  if v_session.status <> 'WORKING' then
    raise exception 'channel_session_offline' using errcode = 'P0001';
  end if;

  select count(*)
    into v_model_count
  from public.ai_models m
  where m.provider = v_version.provider
    and m.model_id = v_version.model
    and m.deprecated_at is null;

  if v_model_count = 0 then
    raise exception 'model_not_found' using errcode = 'P0001';
  end if;

  v_previous_version_id := v_agent.published_version_id;

  if v_previous_version_id is not null and v_previous_version_id <> p_version_id then
    update public.ai_agent_versions
       set status = 'superseded', superseded_at = v_published_at
     where id = v_previous_version_id;
  end if;

  update public.ai_agent_versions
     set status = 'published',
         published_at = v_published_at,
         superseded_at = null
   where id = p_version_id;

  update public.ai_agents
     set published_version_id = p_version_id,
         updated_at = v_published_at
   where id = p_agent_id;

  return query
    select p_agent_id, p_version_id, v_previous_version_id, v_published_at;
end;
$function$
;

revoke execute on function public.fn_publish_ai_agent_version(uuid,uuid,uuid,boolean,text) from public,anon;
grant execute on function public.fn_publish_ai_agent_version(uuid,uuid,uuid,boolean,text) to authenticated,service_role;
revoke execute on function public.fn_publish_ai_agent_version(uuid,uuid,uuid,boolean) from public,anon;
grant execute on function public.fn_publish_ai_agent_version(uuid,uuid,uuid,boolean) to authenticated,service_role;
revoke execute on function public.fn_publish_ai_agent_version(uuid,uuid,uuid) from public,anon;
grant execute on function public.fn_publish_ai_agent_version(uuid,uuid,uuid) to authenticated,service_role;

insert into public.neon_schema_migrations(version,note)
values('20261001_0028_publish_agente_identidade_tecnica','Publish de agente: authenticated apenas com admin da org ou identidade tecnica Neon vinculada a mesma org')
on conflict(version) do update set applied_at=excluded.applied_at,note=excluded.note;

notify pgrst, 'reload schema';
commit;
