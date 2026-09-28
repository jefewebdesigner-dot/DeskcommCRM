-- =============================================================================
-- Identidade de serviço — leitura/escrita em ai_agents.
-- 2026-09-27
--
-- Destino final: neon/migrations/20260927_0008_service_identity_ai_agents.sql
-- BLOQUEADO POR PERMISSÃO (mesmo motivo das 0005/0006/0007): neon/migrations/
-- é nobody:nogroup, claude-runner não escreve ali. Precisa de:
--   chown claude-runner:claude-runner "/root/Zheus AI Projects/deskcommcrm/neon/migrations"
--
-- Quarta tabela com o mesmo padrão medido em produção: POST de criação de
-- agente devolvia "new row violates row-level security policy for table
-- ai_agents". Mesmo escopo das anteriores — só o uid da identidade de
-- serviço.
--
-- ⚠️ Isto já é o sexto ponto (platform_branding, contacts, crm_leads,
-- crm_pipelines, crm_stages, ai_provider_credentials, agora ai_agents) onde
-- o mesmo gap aparece: a identidade de serviço que `createAdminClient()` usa
-- neste projeto Neon não é bypass real de RLS (CLAUDE.md assume que é), então
-- toda tabela tenant-aware que algum código grava via admin client precisa
-- dessa mesma policy, uma a uma, na hora em que alguém tenta usar aquele
-- caminho pela primeira vez. Vale considerar uma correção de raiz (uma
-- policy só, reaproveitada por todas as tabelas com organization_id, em vez
-- de repetir isto tabela por tabela) — fora do escopo desta migration
-- pontual, registrado aqui para quem revisar depois.
-- =============================================================================

begin;

drop policy if exists service_identity_ai_agents_all on public.ai_agents;
create policy service_identity_ai_agents_all
  on public.ai_agents
  for all
  to authenticated
  using (auth.uid() = '713c70ed-4d34-4e91-8d44-f7b1bbc47140'::uuid)
  with check (auth.uid() = '713c70ed-4d34-4e91-8d44-f7b1bbc47140'::uuid);

insert into public.neon_schema_migrations(version, note)
values (
  '20260927_0008_service_identity_ai_agents',
  'Service identity RLS policy for ai_agents (criação/edição de agente)'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    note = excluded.note;

commit;
