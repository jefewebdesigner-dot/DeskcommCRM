-- Neon — as RPCs que o MOTOR chama por SQL, escopadas à organização do contexto.
--
-- O agent-engine chama funções `security definer` que antes só o `service_role` executava
-- (`fn_reply_*`, `fn_meet_delivery_*`, `fn_followup_*`, `fn_appointment_enrollment_current`,
-- `fn_buscar_trechos_das_fontes`, `retrieve_top_k_chunks`, `fn_gasto_de_ia_do_mes`, `fn_agora`).
-- Sem EXECUTE para a role do worker, todo turno de entrega/follow-up/RAG morre com "permission denied".
--
-- Conceder EXECUTE puro seria o buraco que a RLS por organização existe para fechar: são funções
-- DEFINER (rodam como dono, sem RLS) que recebem `p_org` do chamador. Então:
--
--   1. `fn_worker_rpc_guard(p_org)`: quando quem chama é a role de aplicação (`session_user` =
--      `gravity_app_*`), exige que `p_org` seja a organização do CONTEXTO do worker
--      (`fn_worker_org()`); qualquer outra vira 42501. Quem chama por outra via (Data API/service_role,
--      superusuário de teste) não é afetado — o comportamento de hoje fica como está.
--   2. As funções que ESCREVEM ou LEEM dado por `p_org` em plpgsql ganham essa chamada na primeira linha
--      (patch idempotente sobre a definição atual, sem mudar assinatura nem dono).
--   3. Só então o EXECUTE vai para as roles `gravity_app_*`, numa lista explícita.
--
-- Fora da lista, de propósito: `fn_claim_due_followup_enrollments` (claim global entre organizações,
-- só do cron), `emit_event` (o motor a chama pelo Data API), `fn_lgpd_cascade_redact_contact`.
-- As predicates SQL de leitura (`fn_*_current`, `fn_reply_*_policy`) recebem EXECUTE sem guard interno:
-- só respondem sobre ids de job/rascunho que o chamador já precisa conhecer.
--
-- Idempotente; reaplique depois de recriar uma dessas funções.

begin;

create or replace function public.fn_worker_rpc_guard(p_org uuid)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if session_user like 'gravity\_app\_%' and p_org is distinct from public.fn_worker_org() then
    raise exception 'worker_rpc_fora_do_contexto_da_organizacao' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.fn_worker_rpc_guard(uuid) from public, anon, authenticated, service_role;

do $patch$
declare
  alvo record;
  def text;
  novo text;
  -- (função, nome do parâmetro de organização)
  patches constant text[][] := array[
    array['fn_reply_begin', 'p_org'],
    array['fn_reply_settle', 'p_org'],
    array['fn_meet_delivery_settle', 'p_org'],
    array['fn_meet_delivery_policy', 'p_org'],
    array['fn_followup_apply_step', 'p_org'],
    array['fn_followup_patch', 'p_org'],
    array['fn_buscar_trechos_das_fontes', 'p_organization_id'],
    array['retrieve_top_k_chunks', 'p_organization_id']
  ];
  i int;
begin
  for i in 1 .. array_length(patches, 1) loop
    for alvo in
      select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = patches[i][1]
    loop
      def := pg_get_functiondef(alvo.oid);
      continue when def like '%fn_worker_rpc_guard%';
      -- primeira instrução executável do corpo plpgsql: o `begin` depois de `as $function$` (e do declare)
      novo := regexp_replace(def, E'\\ybegin\\y', format(E'begin\n  perform public.fn_worker_rpc_guard(%s);', patches[i][2]), 'i');
      if novo = def then
        raise exception 'nao consegui inserir o guard em %', patches[i][1];
      end if;
      execute novo;
    end loop;
  end loop;
end
$patch$;

do $grants$
declare
  r record;
  f record;
  nomes constant text[] := array[
    'fn_agora', 'fn_gasto_de_ia_do_mes', 'fn_appointment_enrollment_current', 'fn_followup_claim_current',
    'fn_followup_job_current', 'fn_followup_patch', 'fn_followup_apply_step', 'fn_reply_begin',
    'fn_reply_context_current', 'fn_reply_delivery_policy', 'fn_reply_receipt_policy', 'fn_reply_settle',
    'fn_meet_delivery_policy', 'fn_meet_delivery_settle', 'fn_buscar_trechos_das_fontes', 'retrieve_top_k_chunks'
  ];
begin
  for r in select rolname from pg_roles where rolname like 'gravity_app\_%' loop
    for f in
      select p.oid::regprocedure::text as assinatura
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any (nomes)
    loop
      execute format('grant execute on function %s to %I', f.assinatura, r.rolname);
    end loop;
  end loop;
end
$grants$;

insert into public.neon_schema_migrations(version, note)
values (
  '20260930_0018_worker_rpcs_do_motor',
  'RPCs definer do motor escopadas a organizacao do contexto (fn_worker_rpc_guard) + EXECUTE so para gravity_app_* numa lista explicita'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    note = excluded.note;

commit;
