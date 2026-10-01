-- Neon — fn_log_event acessível ao worker somente dentro do contexto da organização.
--
-- O agent-worker usa a role restrita gravity_app_* e vários triggers chamam
-- fn_log_event(). A função era SECURITY DEFINER, mas não concedia EXECUTE à role
-- do worker. Conceder sem guard abriria escrita cross-tenant porque ela recebe
-- organization_id como argumento; por isso o guard vem antes do grant.

begin;

create or replace function public.fn_log_event(
  p_organization_id uuid,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_entity_kind text;
  v_entity_id uuid;
begin
  if session_user like 'gravity\_app\_%' then
    perform public.fn_worker_rpc_guard(p_organization_id);
  end if;

  v_entity_kind := split_part(p_event_type, '.', 1);
  v_entity_id := (p_payload ->> 'lead_id')::uuid;
  if v_entity_id is null then
    v_entity_id := (p_payload ->> (v_entity_kind || '_id'))::uuid;
  end if;

  return public.emit_event(
    p_event_type,
    v_entity_kind,
    v_entity_id,
    p_payload,
    '{}'::jsonb,
    p_organization_id
  );
end
$function$;

revoke execute on function public.fn_log_event(uuid,text,jsonb) from public, anon;
grant execute on function public.fn_log_event(uuid,text,jsonb) to authenticated, service_role;

do $grants$
declare
  r record;
begin
  for r in select rolname from pg_roles where rolname like 'gravity_app\_%' loop
    execute format(
      'grant execute on function public.fn_log_event(uuid,text,jsonb) to %I',
      r.rolname
    );
  end loop;
end
$grants$;

insert into public.neon_schema_migrations(version,note)
values(
  '20261001_0027_fn_log_event_worker',
  'fn_log_event com guard da organizacao do worker + EXECUTE para gravity_app_*'
)
on conflict(version) do update
set applied_at=excluded.applied_at,note=excluded.note;

commit;
