-- `abacatepay_connections` (migration 0358) nasceu com RLS ligada e ZERO
-- policy — e sem bypass, isso bloqueia TUDO, inclusive a própria role da
-- aplicação: medido em produção, `INSERT` por `gravity_app_*` batia em
-- "new row violates row-level security policy" mesmo com GRANT de tabela
-- concedido. SELECT "funcionava" porque RLS sem policy de SELECT devolve
-- ZERO linhas silenciosamente — por isso o sintoma foi "salvei e sumiu",
-- não um erro visível na tela.
--
-- O conserto é o MESMO padrão que `billing_export_connections` (migration
-- 0344) já usa em produção — só que a policy dela nunca tinha virado migration
-- (gap irmão do que a 0356/0357 já corrigiram nesta sessão): uma policy por
-- role de aplicação, restrita por `current_setting('app.<escopo>_org')` setada
-- DENTRO da transação de cada chamada (`withOrganization`, que agora também
-- seta esse config — sem a dupla, a policy existir não bastava).
--
-- A role em produção chama-se `gravity_app_6f629e1848d4` (gerada por
-- instalação pelo provisionamento Gravity/Neon) — nunca hardcoded aqui: o
-- nome muda a cada clone/instalação, e uma policy presa a um nome só quebraria
-- em qualquer banco que não seja este. `EXECUTE format()` descobre a(s)
-- role(s) `gravity_app_*` vivas no banco de destino e aplica a policy a cada
-- uma — zero, uma ou várias, sem precisar saber o sufixo de antemão.
--
-- Backfill da irmã incluído aqui porque é a mesma descoberta, mesma causa,
-- mesmo formato — não vale abrir duas migrations pra contar a mesma história.

do $$
declare
  r record;
begin
  for r in select rolname from pg_roles where rolname ~ '^gravity_app_'
  loop
    if to_regclass('public.abacatepay_connections') is not null
      and not exists (
        select 1 from pg_policies
        where tablename = 'abacatepay_connections'
          and policyname = 'abacatepay_runtime_tenant_' || r.rolname
      )
    then
      execute format(
        'create policy %I on public.abacatepay_connections for all to %I
           using (organization_id = nullif(current_setting(''app.abacatepay_org'', true), '''')::uuid)
           with check (organization_id = nullif(current_setting(''app.abacatepay_org'', true), '''')::uuid)',
        'abacatepay_runtime_tenant_' || r.rolname,
        r.rolname
      );
    end if;

    if to_regclass('public.billing_export_connections') is not null
      and not exists (
        select 1 from pg_policies
        where tablename = 'billing_export_connections'
          and policyname = 'billing_export_runtime_tenant_' || r.rolname
      )
    then
      execute format(
        'create policy %I on public.billing_export_connections for all to %I
           using (organization_id = nullif(current_setting(''app.billing_export_org'', true), '''')::uuid)
           with check (organization_id = nullif(current_setting(''app.billing_export_org'', true), '''')::uuid)',
        'billing_export_runtime_tenant_' || r.rolname,
        r.rolname
      );
    end if;
  end loop;
end
$$;
