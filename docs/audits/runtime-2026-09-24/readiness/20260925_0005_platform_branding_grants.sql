-- =============================================================================
-- platform_branding — grants + RLS para a Data API (role `authenticated`)
-- 2026-09-25
--
-- Destino final: neon/migrations/20260925_0005_platform_branding_grants.sql
-- BLOQUEADO POR PERMISSÃO: neon/migrations/ é nobody:nogroup (755), o processo
-- claude-runner não consegue escrever ali. Precisa de:
--   chown claude-runner:claude-runner "/root/Zheus AI Projects/deskcommcrm/neon/migrations"
-- Até lá este arquivo fica aqui, JÁ APLICADO em homologacao (ver relatório).
--
-- platform_branding tinha RLS habilitada com ZERO policies e ZERO GRANTs para
-- `authenticated` — toda leitura/escrita via createAdminClient() (que passa
-- pela Data API com o JWT da identidade de serviço, role `authenticated`,
-- não um bypass real de RLS) falhava com "permission denied for table".
--
-- Isto inclui a LEITURA usada por lib/branding/instalacao.ts na tela de login
-- pública: o resolvedor "nunca lança" e cai no .env, então o sintoma era só
-- nome/cor errados, não erro visível — até a escrita pelo /admin/marca, que
-- expõe o erro de permissão de fato.
--
-- Neste projeto (Neon, não Supabase clássico) `service_role` não tem
-- BYPASSRLS e `authenticator` não é membro de `service_role` — o ator real de
-- qualquer escrita feita por createAdminClient() é sempre a identidade de
-- serviço (NEON_SERVICE_USER_ID), autenticada como `authenticated` comum.
-- A policy de escrita é restrita a esse uid literal, não a fn_is_platform_admin(),
-- porque fn_is_platform_admin() checa o admin humano na camada Next.js
-- (requirePlatformAdmin()), não quem de fato assina o INSERT/UPDATE no banco.
--
-- Leitura é liberada a qualquer chamador autenticado: platform_branding é
-- dado inerentemente público (aparece na tela de login, sem sessão).
-- =============================================================================

begin;

grant select, insert, update on public.platform_branding to authenticated;

drop policy if exists platform_branding_select_all on public.platform_branding;
create policy platform_branding_select_all
  on public.platform_branding
  for select
  to authenticated
  using (true);

drop policy if exists platform_branding_write_service_identity on public.platform_branding;
create policy platform_branding_write_service_identity
  on public.platform_branding
  for insert
  to authenticated
  with check (auth.uid() = '713c70ed-4d34-4e91-8d44-f7b1bbc47140'::uuid);

drop policy if exists platform_branding_update_service_identity on public.platform_branding;
create policy platform_branding_update_service_identity
  on public.platform_branding
  for update
  to authenticated
  using (auth.uid() = '713c70ed-4d34-4e91-8d44-f7b1bbc47140'::uuid)
  with check (auth.uid() = '713c70ed-4d34-4e91-8d44-f7b1bbc47140'::uuid);

insert into public.neon_schema_migrations(version, note)
values (
  '20260925_0005_platform_branding_grants',
  'Grant + RLS policies for platform_branding via Data API authenticated role'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    note = excluded.note;

commit;
