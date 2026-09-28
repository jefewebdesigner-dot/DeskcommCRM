-- =============================================================================
-- Identidade de serviço — leitura/escrita em contacts, crm_leads, crm_pipelines
-- e crm_stages, para o cron periciaia-billing-sync (e qualquer outro uso
-- futuro de createAdminClient() nessas tabelas).
-- 2026-09-26
--
-- Destino final: neon/migrations/20260926_0006_service_identity_crm_write.sql
-- BLOQUEADO POR PERMISSÃO (mesmo motivo da 0005): neon/migrations/ é
-- nobody:nogroup, claude-runner não escreve ali. Precisa de:
--   chown claude-runner:claude-runner "/root/Zheus AI Projects/deskcommcrm/neon/migrations"
--
-- ── O bug que isto conserta ──────────────────────────────────────────────
--
-- Medido rodando o cron de verdade: `createAdminClient()` (que neste projeto
-- Neon autentica como a identidade de serviço via Data API, role `authenticated`
-- comum — NÃO um bypass real de RLS, ver lib/supabase/admin.ts) voltava ZERO
-- linhas ao consultar contacts/crm_leads/crm_pipelines/crm_stages, mesmo com a
-- linha existindo e a query certa. Causa: as quatro tabelas têm RLS restrita a
-- `organization_id IN (fn_user_org_ids())` ou `fn_is_platform_admin()` — e a
-- identidade de serviço não é membro de nenhuma organização nem platform_admin.
-- A doutrina do CLAUDE.md ("service role bypassa RLS") não vale neste deploy
-- Neon; é gap conhecido, sinalizado desde a migration 0005, ainda maior do que
-- se sabia: alcança toda tabela tenant-aware, não só platform_branding.
--
-- ── Escopo desta migration ───────────────────────────────────────────────
--
-- NÃO conserta o gap geral (dar bypass de verdade exigiria mexer em
-- service_role/authenticator, fora do escopo de agora). Só abre, para o uid
-- LITERAL e conhecido da identidade de serviço, exatamente o que o cron de
-- sincronização de billing precisa: ler pipeline/etapas, e ler+criar+atualizar
-- contato e negócio. Não dá DELETE, não dá acesso a outras tabelas, não muda
-- nada para usuários reais — são políticas PERMISSIVE adicionais, que só
-- ampliam por OR o que já existia.
-- =============================================================================

begin;

drop policy if exists service_identity_contacts_all on public.contacts;
create policy service_identity_contacts_all
  on public.contacts
  for all
  to authenticated
  using (auth.uid() = '713c70ed-4d34-4e91-8d44-f7b1bbc47140'::uuid)
  with check (auth.uid() = '713c70ed-4d34-4e91-8d44-f7b1bbc47140'::uuid);

drop policy if exists service_identity_crm_leads_select on public.crm_leads;
create policy service_identity_crm_leads_select
  on public.crm_leads
  for select
  to authenticated
  using (auth.uid() = '713c70ed-4d34-4e91-8d44-f7b1bbc47140'::uuid);

drop policy if exists service_identity_crm_leads_insert on public.crm_leads;
create policy service_identity_crm_leads_insert
  on public.crm_leads
  for insert
  to authenticated
  with check (auth.uid() = '713c70ed-4d34-4e91-8d44-f7b1bbc47140'::uuid);

drop policy if exists service_identity_crm_leads_update on public.crm_leads;
create policy service_identity_crm_leads_update
  on public.crm_leads
  for update
  to authenticated
  using (auth.uid() = '713c70ed-4d34-4e91-8d44-f7b1bbc47140'::uuid)
  with check (auth.uid() = '713c70ed-4d34-4e91-8d44-f7b1bbc47140'::uuid);

drop policy if exists service_identity_crm_pipelines_select on public.crm_pipelines;
create policy service_identity_crm_pipelines_select
  on public.crm_pipelines
  for select
  to authenticated
  using (auth.uid() = '713c70ed-4d34-4e91-8d44-f7b1bbc47140'::uuid);

drop policy if exists service_identity_crm_stages_select on public.crm_stages;
create policy service_identity_crm_stages_select
  on public.crm_stages
  for select
  to authenticated
  using (auth.uid() = '713c70ed-4d34-4e91-8d44-f7b1bbc47140'::uuid);

insert into public.neon_schema_migrations(version, note)
values (
  '20260926_0006_service_identity_crm_write',
  'Service identity RLS policies for contacts/crm_leads/crm_pipelines/crm_stages (periciaia-billing-sync cron)'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    note = excluded.note;

commit;
