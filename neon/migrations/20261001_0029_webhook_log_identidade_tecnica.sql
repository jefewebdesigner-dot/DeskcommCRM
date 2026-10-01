-- Neon — DML técnico no arquivo forense de webhooks.
--
-- createAdminClient usa JWT técnico com role authenticated. A policy
-- service_identity_bypass já restringe ALL à identidade server específica, mas
-- o ACL da tabela tinha só SELECT para authenticated; o Postgres recusava INSERT
-- antes de chegar ao RLS. Resultado: webhook era processado e o arquivo forense
-- ficava vazio.
--
-- UPDATE/DELETE entram junto porque a retenção/arquivamento usa o mesmo cliente
-- técnico. Usuário autenticado comum continua sem policy de escrita.

begin;

grant insert, update, delete on table public.webhook_events_log to authenticated;

insert into public.neon_schema_migrations(version,note)
values(
  '20261001_0029_webhook_log_identidade_tecnica',
  'DML em webhook_events_log para authenticated; RLS service_identity_bypass mantém escrita restrita à identidade tecnica'
)
on conflict(version) do update
set applied_at=excluded.applied_at,note=excluded.note;

commit;
