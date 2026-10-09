-- Fecha o que a 0044 deixou de fora: funções que o servidor chama por `.rpc()` mas que TAMBÉM são
-- chamadas por dentro do banco (triggers/outras funções) ou são de linguagem SQL. Nelas a guarda
-- direta quebraria o chamador interno, então cada uma ganha uma PORTA DO SERVIDOR:
-- `<nome>_servidor`, mesma assinatura (mesmos nomes de parâmetro — o Data API chama por nome),
-- SECURITY DEFINER, com a guarda fn_neon_service_identity_ok(), que só repassa a chamada.
-- O admin client (lib/supabase/admin.ts) troca o nome dessas funções pela porta.
-- A função original continua intocada para quem a chama por dentro.
begin;

do $porta$
declare
  r record;
  chamada text;
  corpo text;
  n int := 0;
begin
  for r in
    select p.oid, p.proname, p.pronargs,
           pg_get_function_arguments(p.oid) as args,
           pg_get_function_result(p.oid) as res
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname = any (array[
         'fn_followup_patch', 'fn_request_channel_routing', 'fn_service_boundary', 'fn_service_event_origin',
         'fn_appointment_enrollment_current', 'fn_claim_due_followup_enrollments', 'fn_followup_claim_current',
         'fn_followup_job_current', 'fn_reply_delivery_policy', 'fn_reply_receipt_policy',
         'fn_service_observe_command', 'fn_support_callback_write_allowed', 'fn_accept_team_invite'
       ])
  loop
    select coalesce(string_agg('$' || i, ', ' order by i), '') into chamada
      from generate_series(1, r.pronargs) as i;
    chamada := format('public.%I(%s)', r.proname, chamada);
    if r.res = 'void' then
      corpo := 'perform ' || chamada || ';';
    elsif r.res ~* '^(setof |table\()' then
      corpo := 'return query select * from ' || chamada || ';';
    else
      corpo := 'return ' || chamada || ';';
    end if;
    execute format(
      'create or replace function public.%I(%s) returns %s language plpgsql security definer '
      || 'set search_path = public, pg_temp as $w$ begin '
      || 'if not public.fn_neon_service_identity_ok() then '
      || 'raise exception ''service_identity_required'' using errcode = ''42501''; end if; '
      || '%s end $w$',
      r.proname || '_servidor', r.args, r.res, corpo);
    execute format('revoke all on function public.%I(%s) from public, anon',
      r.proname || '_servidor', pg_get_function_identity_arguments(r.oid));
    execute format('grant execute on function public.%I(%s) to authenticated, service_role',
      r.proname || '_servidor', pg_get_function_identity_arguments(r.oid));
    n := n + 1;
  end loop;
  raise notice 'portas do servidor criadas: %', n;
end
$porta$;

-- A role de aplicação do Neon (pool do worker) também passa pela guarda; dá a ela o mesmo acesso.
do $app$
declare r record; f record;
begin
  for r in select rolname from pg_roles where rolname ~ '^gravity_app_[a-z0-9]+$' loop
    for f in select p.oid from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
              where ns.nspname = 'public' and p.proname like 'fn\_%\_servidor' escape '\' loop
      execute format('grant execute on function %s to %I', f.oid::regprocedure, r.rolname);
    end loop;
  end loop;
end
$app$;

insert into public.neon_schema_migrations(version,note)
values('20261009_0045_porta_do_servidor','Portas <nome>_servidor (guarda da identidade técnica) para funções chamadas também por dentro do banco ou em SQL')
on conflict(version) do update set applied_at=excluded.applied_at,note=excluded.note;
notify pgrst,'reload schema';
commit;
