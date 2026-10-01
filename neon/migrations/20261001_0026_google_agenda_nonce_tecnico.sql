-- Google Agenda: o callback roda pelo Data API com a identidade técnica Neon.
--
-- A tabela calendar_oauth_nonces já é protegida por RLS. No Neon,
-- createAdminClient() usa role authenticated + JWT da identidade técnica; sem
-- privilégio INSERT o PostgreSQL recusa antes de avaliar a policy.
--
-- Abrimos SOMENTE INSERT para authenticated e exigimos a identidade técnica na
-- policy. Usuário autenticado comum continua sem conseguir inserir, ler,
-- alterar ou apagar nonces.

begin;

drop policy if exists neon_service_calendar_oauth_nonce_insert
  on public.calendar_oauth_nonces;

create policy neon_service_calendar_oauth_nonce_insert
  on public.calendar_oauth_nonces
  for insert
  to authenticated
  with check (public.fn_neon_service_identity_ok());

grant insert on public.calendar_oauth_nonces to authenticated;
revoke select, update, delete, truncate, references, trigger
  on public.calendar_oauth_nonces from authenticated;

insert into public.neon_schema_migrations(version,note)
values(
  '20261001_0026_google_agenda_nonce_tecnico',
  'Identidade tecnica Neon pode queimar nonce OAuth via INSERT protegido por RLS'
)
on conflict(version) do update
set applied_at=excluded.applied_at,note=excluded.note;

notify pgrst, 'reload schema';

commit;
