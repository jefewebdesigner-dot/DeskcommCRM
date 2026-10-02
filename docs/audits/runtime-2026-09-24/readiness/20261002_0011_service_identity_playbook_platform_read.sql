-- 0011: leitura da camada PLATFORM do playbook para qualquer role de conexão
--
-- Bug real medido em produção (PeríciaIA): toda chamada de "Executar teste"
-- de agente falha com "ponteiro da camada plataforma ausente", para
-- QUALQUER agente de QUALQUER organização. Causa: `loadPlaybook()` lê
-- `playbook_pointers`/`playbook_versions` pela conexão de prévia
-- (`createRequestPoolForUser`, que autentica como a role de `DATABASE_URL`
-- — nesta instalação `gravity_app_6f629e1848d4` — e só seta
-- `request.jwt.claim.sub`, nunca `app.worker_uid`/`app.worker_secret`).
-- As políticas RLS existentes nessas duas tabelas não cobrem essa conexão:
--   - `worker_platform_read`/`worker_org_scope` (role do worker) exigem
--     `fn_worker_identity_ok()`, que lê `app.worker_uid`/`app.worker_secret`
--     — ausentes na prévia, então retorna false
--   - `service_identity_bypass` exige auth.uid() = identidade de serviço
--   - `tenant_isolation_*_all` (role public) nunca casa `organization_id
--     IN (...)` com NULL
-- Resultado: RLS filtra a linha pra zero, sem erro de Postgres, e o código
-- de aplicação lê "não existe" e devolve o 422 de ponteiro ausente.
--
-- Primeira tentativa desta migration usava `to authenticated`, mas a role
-- de conexão real (`gravity_app_6f629e1848d4`) não é membro de
-- `authenticated` — confirmado via pg_auth_members, zero linhas. Conteúdo
-- da camada platform é compliance fixo da instalação (não dado de tenant,
-- sem PII), e o objetivo do ponteiro já é ser lido por qualquer
-- organização (ver `playbook.ts`/`playbook-seed.ts`) — a política correta
-- é leitura liberada a QUALQUER role (`to public`, sem restrição de role),
-- nunca escrita.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'playbook_pointers' and policyname = 'public_platform_read'
  ) then
    create policy public_platform_read on public.playbook_pointers
      for select to public
      using (organization_id is null and layer = 'platform');
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'playbook_versions' and policyname = 'public_platform_read'
  ) then
    create policy public_platform_read on public.playbook_versions
      for select to public
      using (organization_id is null and layer = 'platform');
  end if;
end $$;
