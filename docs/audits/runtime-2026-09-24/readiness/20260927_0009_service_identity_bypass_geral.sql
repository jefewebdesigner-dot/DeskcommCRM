-- =============================================================================
-- Correção de raiz: identidade de serviço lê/escreve em TODA tabela
-- tenant-aware (organization_id + RLS), não mais uma de cada vez.
-- 2026-09-27
--
-- Destino final: neon/migrations/20260927_0009_service_identity_bypass_geral.sql
-- BLOQUEADO POR PERMISSÃO (mesmo motivo das 0005-0008): neon/migrations/ é
-- nobody:nogroup, claude-runner não escreve ali. Precisa de:
--   chown claude-runner:claude-runner "/root/Zheus AI Projects/deskcommcrm/neon/migrations"
--
-- ── Por que isto, e por que agora ────────────────────────────────────────
--
-- Sétima vez no mesmo dia que o mesmo gap aparece (platform_branding,
-- contacts, crm_leads, crm_pipelines, crm_stages, ai_provider_credentials,
-- ai_agents, ai_agent_versions — migrations 0005 a 0008). O padrão sempre é
-- o mesmo: `createAdminClient()` neste projeto Neon autentica como a
-- identidade de serviço via Data API, role `authenticated` comum — NÃO um
-- bypass real de RLS (CLAUDE.md assume "service role bypassa RLS", que vale
-- para Supabase clássico e NÃO vale para este deploy Neon; ver
-- lib/supabase/admin.ts). Toda vez que um fluxo novo grava por esse caminho
-- numa tabela ainda não coberta, cai a mesma exceção, e corrigir uma tabela
-- de cada vez só descobre a próxima na hora em que alguém tenta usá-la.
--
-- ── O que isto NÃO é ─────────────────────────────────────────────────────
--
-- Não é ampliar autoridade de ninguém novo: TODO `createAdminClient()` do
-- código já assume, hoje, que pode ler/escrever qualquer organização — é
-- assim que o produto inteiro foi escrito (CLAUDE.md, anti-pattern nº 10:
-- "Service role usado em request handler sem filtrar organization_id
-- manualmente" — a doutrina cobra o handler filtrar, não proíbe o service
-- role de alcançar). Esta migration só faz essa suposição, que já está em
-- todo canto do código, voltar a ser verdadeira no banco. Não muda nada
-- para usuários reais: é uma política PERMISSIVE a mais, que só amplia por
-- OR o que as políticas de tenant já permitiam — nenhuma política existente
-- é alterada ou removida.
--
-- ── Escopo exato ─────────────────────────────────────────────────────────
--
-- Só o uid literal e conhecido da identidade de serviço
-- (713c70ed-4d34-4e91-8d44-f7b1bbc47140). Só tabelas do schema `public` que
-- (a) têm RLS habilitada e (b) têm coluna `organization_id` — a marca de
-- tabela tenant-aware neste projeto. Tabelas sem essa coluna (ex.:
-- platform_admins, organizations em si) não são tocadas por este loop; quem
-- precisar delas continua pedindo policy própria, como platform_branding e
-- organizations já foram tratadas antes (0005, e o achado de 2026-09-26
-- sobre `organizations`, ainda pendente).
--
-- Idempotente: `drop policy if exists` + `create policy` por tabela: rodar
-- de novo não duplica nem falha.
-- =============================================================================

begin;

do $$
declare
  r record;
  ja_tem boolean;
begin
  for r in
    select c.relname as tabela
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity = true
      and exists (
        select 1 from information_schema.columns col
        where col.table_schema = 'public'
          and col.table_name = c.relname
          and col.column_name = 'organization_id'
      )
  loop
    execute format('drop policy if exists service_identity_bypass on public.%I', r.tabela);
    execute format(
      'create policy service_identity_bypass on public.%I for all to authenticated ' ||
      'using (auth.uid() = %L::uuid) with check (auth.uid() = %L::uuid)',
      r.tabela,
      '713c70ed-4d34-4e91-8d44-f7b1bbc47140',
      '713c70ed-4d34-4e91-8d44-f7b1bbc47140'
    );
  end loop;
end
$$;

insert into public.neon_schema_migrations(version, note)
values (
  '20260927_0009_service_identity_bypass_geral',
  'Service identity RLS bypass policy applied to every tenant-aware table (organization_id + RLS enabled) in public schema'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    note = excluded.note;

commit;
