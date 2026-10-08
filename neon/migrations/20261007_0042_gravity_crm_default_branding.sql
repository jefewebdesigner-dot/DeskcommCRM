-- Gravity CRM — migração conservadora da marca padrão legada.
-- Só altera a linha quando ela veio automaticamente do ambiente.
-- Marca escolhida por uma pessoa (seeded_from_env=false) é preservada.
begin;

do $branding$
begin
  if to_regclass('public.platform_branding') is not null then
    update public.platform_branding
    set app_name='Gravity CRM'
    where id=1
      and seeded_from_env=true
      and lower(regexp_replace(coalesce(app_name,''),'[[:space:]]+','','g'))='deskcommcrm';
  end if;
end
$branding$;

insert into public.neon_schema_migrations(version,note)
values(
  '20261007_0042_gravity_crm_default_branding',
  'Gravity CRM: converte somente a marca padrão legada sem sobrescrever white-label humano'
)
on conflict(version) do update
set applied_at=excluded.applied_at,note=excluded.note;

notify pgrst,'reload schema';
commit;
