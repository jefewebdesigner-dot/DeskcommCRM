-- Neon — o drain do event_log usa a identidade técnica server via Data API.
--
-- createAdminClient() autentica como role "authenticated" com o UID técnico.
-- A policy service_identity_bypass já restringe ALL exatamente a esse UID,
-- porém o ACL da tabela tinha apenas SELECT para authenticated. O PostgreSQL
-- recusava UPDATE antes de avaliar a RLS; o drain enxergava eventos pending,
-- mas nunca conseguia claimar nenhum deles.
--
-- Concedemos SOMENTE UPDATE. Usuário autenticado comum continua sem conseguir
-- escrever porque não satisfaz a policy service_identity_bypass.

begin;

grant update on table public.event_log to authenticated;

insert into public.neon_schema_migrations(version,note)
values(
  '20261001_0036_event_log_drain_identidade_tecnica',
  'UPDATE em event_log para authenticated; RLS service_identity_bypass mantém claim restrito à identidade técnica'
)
on conflict(version) do update
set applied_at=excluded.applied_at,note=excluded.note;

notify pgrst, 'reload schema';
commit;
