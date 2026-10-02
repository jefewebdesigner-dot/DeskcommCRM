-- Neon — a identidade técnica precisa LER a organização para serviços server-only.
--
-- O Radar de risco lê organizations.settings.agenda para proteger compromissos
-- antes de classificar um lead como frio. As tabelas de leads/agenda já tinham
-- policy técnica, mas organizations perdeu esse caminho numa migração posterior:
-- o cron respondia 200, lia 436 leads e abortava a organização inteira como
-- risk_agenda_indisponivel porque a linha de organizations ficava invisível.
--
-- Somente SELECT. Nenhuma escrita é aberta, e usuários autenticados comuns
-- continuam dependendo das policies de tenancy existentes.

begin;

grant select on public.organizations to authenticated;

drop policy if exists service_identity_organizations_select on public.organizations;
create policy service_identity_organizations_select
  on public.organizations
  for select
  to authenticated
  using (public.fn_neon_service_identity_ok());

insert into public.neon_schema_migrations(version, note)
values (
  '20261002_0037_service_identity_organizations_select',
  'Identidade técnica server-only pode ler organizations.settings; necessário para proteção Agenda/Radar'
)
on conflict (version) do update
set applied_at = excluded.applied_at,
    note = excluded.note;

notify pgrst, 'reload schema';

commit;
