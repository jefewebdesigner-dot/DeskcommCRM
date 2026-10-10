-- Os crons `data-retention` e `sync-model-catalog` respondiam 500 no Neon pela mesma causa da 0044:
--   - as 7 funções de expurgo/poda só tinham EXECUTE para `service_role` (o admin client roda como
--     `authenticated` com a identidade técnica do servidor);
--   - `ai_models` (catálogo global de modelos) só tinha política de LEITURA: o upsert do catálogo
--     batia na RLS.
-- Mesma receita: guarda fn_neon_service_identity_ok() no corpo + EXECUTE; e política de escrita em
-- ai_models só para a identidade técnica do servidor.
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
         'fn_expurgar_auditoria_vencida', 'fn_expurgar_avisos_de_caso_vencidos',
         'fn_expurgar_conversa_do_caso_vencida', 'fn_expurgar_espelho_da_agenda',
         'fn_expurgar_nonces_de_oauth', 'fn_expurgar_passagens_vencidas', 'fn_podar_fila_de_jobs'
       ])
  loop
    def := pg_get_functiondef(r.oid);
    if position('service_identity_required' in def) > 0 then
      continue;
    end if;
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
  raise notice 'funções de manutenção guardadas e liberadas: %', n;
end
$guarda$;

grant insert, update on public.ai_models to authenticated;
drop policy if exists neon_server_service_write on public.ai_models;
create policy neon_server_service_write on public.ai_models
  for insert to authenticated with check (public.fn_neon_service_identity_ok());
drop policy if exists neon_server_service_update on public.ai_models;
create policy neon_server_service_update on public.ai_models
  for update to authenticated
  using (public.fn_neon_service_identity_ok()) with check (public.fn_neon_service_identity_ok());

insert into public.neon_schema_migrations(version,note)
values('20261010_0046_crons_de_manutencao_no_neon','data-retention e sync-model-catalog no Neon: guarda + EXECUTE nas funções de expurgo; escrita em ai_models só para a identidade técnica')
on conflict(version) do update set applied_at=excluded.applied_at,note=excluded.note;
notify pgrst,'reload schema';
commit;
