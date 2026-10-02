-- =============================================================================
-- Identidade de serviço — leitura/escrita em organizations (a própria linha).
-- 2026-10-02
--
-- Destino final: neon/migrations/20261002_0010_service_identity_organizations.sql
-- BLOQUEADO POR PERMISSÃO (mesmo motivo das 0005-0009): neon/migrations/ é
-- nobody:nogroup, claude-runner não escreve ali. Precisa de:
--   chown claude-runner:claude-runner "/root/Zheus AI Projects/deskcommcrm/neon/migrations"
--
-- A migration 0009 (service_identity_bypass_geral) cobriu toda tabela com
-- coluna `organization_id` — e DELIBERADAMENTE não cobriu `organizations`,
-- porque ali a coluna de identidade é `id`, não `organization_id` (é a
-- própria organização, não uma tabela tenant-aware dependente dela). O
-- comentário daquela migration já previa isto: "organizations em si [...]
-- não são tocadas por este loop [...] quem precisar delas continua pedindo
-- policy própria".
--
-- Medido agora: o wizard de onboarding (`app/actions/onboarding/_shared.ts`,
-- `patchOnboardingState`) grava `onboarding_state`/`display_name`/`timezone`
-- em `organizations` via `createAdminClient()`. RLS bloqueia silenciosamente
-- — SEM erro, porque o UPDATE só filtra linhas que a policy deixa ver, e
-- zero linhas visíveis não é erro, é "nada para atualizar". O wizard lia
-- `ok:true` de um array vazio, redirecionava para `/onboarding`, que relia o
-- estado (ainda vazio) e mandava de volta pro mesmo passo — loop infinito e
-- mudo, sem toast, sem log, sem 500. Exatamente o modo de falha mais caro
-- deste gap: parece "não fiz nada" em vez de "não consegui".
-- =============================================================================

begin;

drop policy if exists service_identity_bypass on public.organizations;
create policy service_identity_bypass
  on public.organizations
  for all
  to authenticated
  using (auth.uid() = '713c70ed-4d34-4e91-8d44-f7b1bbc47140'::uuid)
  with check (auth.uid() = '713c70ed-4d34-4e91-8d44-f7b1bbc47140'::uuid);

insert into public.neon_schema_migrations(version, note)
values (
  '20261002_0010_service_identity_organizations',
  'Service identity RLS bypass policy for organizations table itself (onboarding wizard writes)'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    note = excluded.note;

commit;
