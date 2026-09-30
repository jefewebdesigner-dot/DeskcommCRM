-- Neon — a role de aplicação precisa poder EXECUTAR as funções que as policies dela chamam.
--
-- O Postgres avalia as policies PERMISSIVE que se aplicam à role, e uma expressão que chama função
-- sem EXECUTE para a role falha com "permission denied for function ..." — MESMO que outra policy
-- (a `worker_org_scope`) já liberasse a linha. Foi o que o worker viu em `messages`/`conversations`
-- (`fn_can_view_conversation`) e `crm_leads` (`fn_can_view_lead`).
--
-- Só entram as funções realmente citadas por policy `TO public` ou `TO gravity_app_*`: são
-- verificadores de autorização por `auth.uid()` (devolvem falso/nulo para quem não é usuário),
-- então conceder EXECUTE não abre dado — só deixa a policy ser avaliada. Policies `TO authenticated`
-- (ex.: `fn_support_write_allowed`) não são avaliadas para esta role e ficam de fora.
-- Idempotente; reaplique depois de policy nova.

begin;

do $grants$
declare
  r record;
  fn record;
begin
  for r in select oid, rolname from pg_roles where rolname like 'gravity_app\_%' loop
    for fn in
      select distinct p.oid::regprocedure::text as assinatura
      from pg_depend d
      join pg_policy pol on d.classid = 'pg_policy'::regclass and d.objid = pol.oid
      join pg_proc p on d.refclassid = 'pg_proc'::regclass and d.refobjid = p.oid
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and (0 = any(pol.polroles) or r.oid = any(pol.polroles))
        and not has_function_privilege(r.rolname, p.oid, 'execute')
    loop
      execute format('grant execute on function %s to %I', fn.assinatura, r.rolname);
    end loop;
  end loop;
end
$grants$;

insert into public.neon_schema_migrations(version, note)
values (
  '20260930_0017_gravity_app_executa_funcoes_das_policies',
  'EXECUTE nas funcoes citadas por policies aplicaveis a gravity_app_* (fn_can_view_conversation/lead): sem isso a policy do worker nem chega a ser avaliada'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    note = excluded.note;

commit;
