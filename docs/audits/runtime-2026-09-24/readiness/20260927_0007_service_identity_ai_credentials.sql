-- =============================================================================
-- Identidade de serviço — leitura/escrita em ai_provider_credentials.
-- 2026-09-27
--
-- Destino final: neon/migrations/20260927_0007_service_identity_ai_credentials.sql
-- BLOQUEADO POR PERMISSÃO (mesmo motivo das 0005/0006): neon/migrations/ é
-- nobody:nogroup, claude-runner não escreve ali. Precisa de:
--   chown claude-runner:claude-runner "/root/Zheus AI Projects/deskcommcrm/neon/migrations"
--
-- Mesmo padrão medido em produção, terceira tabela: POST /api/v1/ai/credentials
-- devolvia 500 "Erro ao criar credential." — `guardarCredencial()` grava via
-- `createAdminClient()`, e `ai_provider_credentials` tem RLS restrita a
-- `fn_user_org_ids()`/`fn_is_platform_admin()` (a identidade de serviço não é
-- nenhum dos dois). Mesmo escopo das 0005/0006: só o uid literal da
-- identidade de serviço, só o necessário (select/insert/update — sem delete).
-- =============================================================================

begin;

drop policy if exists service_identity_ai_credentials_all on public.ai_provider_credentials;
create policy service_identity_ai_credentials_all
  on public.ai_provider_credentials
  for all
  to authenticated
  using (auth.uid() = '713c70ed-4d34-4e91-8d44-f7b1bbc47140'::uuid)
  with check (auth.uid() = '713c70ed-4d34-4e91-8d44-f7b1bbc47140'::uuid);

insert into public.neon_schema_migrations(version, note)
values (
  '20260927_0007_service_identity_ai_credentials',
  'Service identity RLS policy for ai_provider_credentials (IA > Credenciais)'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    note = excluded.note;

commit;
