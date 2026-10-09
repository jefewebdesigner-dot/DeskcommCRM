-- Mesma falha da 0043, em lote: funções que o servidor chama pelo admin client (`.rpc(...)`) só
-- tinham EXECUTE para `service_role` (herança do Supabase). No Neon o admin client roda como
-- `authenticated` com a identidade técnica do servidor, então cada uma respondia
-- "permission denied" — o onboarding não salvava o quadro, extensões, follow-up, suporte etc.
--
-- Para cada função: injeta a guarda `fn_neon_service_identity_ok()` no início do corpo e só então
-- libera EXECUTE para `authenticated`. Sem a guarda, qualquer usuário logado chamaria funções
-- SECURITY DEFINER passando o organization_id de outra empresa.
--
-- Fora deste lote, de propósito: funções chamadas DE DENTRO de outras funções/fluxos (a guarda
-- quebraria o chamador interno) — fn_followup_patch, fn_request_channel_routing,
-- fn_service_boundary, fn_service_event_origin — e as de linguagem SQL (sem bloco begin).
begin;

do $guarda$
declare
  r record;
  def text;
  novo text;
  n int := 0;
begin
  for r in
    select p.oid, p.proname
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      join pg_language l on l.oid = p.prolang
     where ns.nspname = 'public'
       and l.lanname = 'plpgsql'
       and p.proname = any (array[
         'fn_accept_team_invite', 'fn_aplicar_quadro_do_onboarding', 'fn_appointment_confirmation_sweep',
         'fn_appointment_recover', 'fn_channel_routing_claim', 'fn_configurar_pre_go_live_canal',
         'fn_contar_mensagem_ignorada', 'fn_definir_logo_da_organizacao', 'fn_demanda_encerrar',
         'fn_end_support', 'fn_estampar_atribuicao_de_anuncio', 'fn_extensions_admit_catalog',
         'fn_extensions_cancel_install', 'fn_extensions_configure', 'fn_extensions_fail_install',
         'fn_extensions_finish_install', 'fn_extensions_installation_counts', 'fn_extensions_prepare_install',
         'fn_extensions_remove_installation', 'fn_extensions_revert_install', 'fn_followup_apply_step',
         'fn_followup_inline_settle', 'fn_lgpd_cascade_redact_contact', 'fn_meet_delivery_policy',
         'fn_publish_followup_flow_version', 'fn_registrar_jid_do_aviso', 'fn_reply_prepare',
         'fn_reply_record_receipt', 'fn_routing_unassigned_notice', 'fn_start_support'
       ])
  loop
    def := pg_get_functiondef(r.oid);
    if position('service_identity_required' in def) > 0 then
      continue;  -- já guardada (reaplicação)
    end if;
    -- Primeira linha `begin` = início do corpo (blocos aninhados vêm depois dela).
    novo := regexp_replace(def, E'\\n[ \\t]*begin[ \\t]*\\n',
      E'\nbegin\n  if not public.fn_neon_service_identity_ok() then\n    raise exception ''service_identity_required'' using errcode = ''42501'';\n  end if;\n', 'i');
    if novo = def then
      raise exception 'guarda não aplicada em % (sem linha begin)', r.proname;
    end if;
    execute novo;
    execute format('revoke all on function %s from public, anon', r.oid::regprocedure);
    execute format('grant execute on function %s to authenticated, service_role', r.oid::regprocedure);
    n := n + 1;
  end loop;
  raise notice 'funções guardadas e liberadas: %', n;
end
$guarda$;

-- Invocadoras (RLS vale normalmente): só faltava o EXECUTE.
do $inv$
declare r record;
begin
  for r in select p.oid from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public' and p.proname in ('fn_agora', 'fn_gasto_de_ia_do_mes') and not p.prosecdef
  loop
    execute format('grant execute on function %s to authenticated', r.oid::regprocedure);
  end loop;
end
$inv$;

insert into public.neon_schema_migrations(version,note)
values('20261009_0044_funcoes_do_servidor_no_neon','Funções do admin client com guarda da identidade técnica + EXECUTE para authenticated (onboarding, extensões, follow-up, suporte)')
on conflict(version) do update set applied_at=excluded.applied_at,note=excluded.note;
notify pgrst,'reload schema';
commit;
