-- Optional module: fixed provisioner; no table until installation is requested.
create or replace function public.fn_install_billing_export_module()
returns void language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if current_setting('role', true) <> 'service_role'
    and not (session_user = current_user and current_setting('role', true) = 'none') then
    raise exception 'installer_required' using errcode = '42501';
  end if;
  create table if not exists public.billing_export_connections (
    organization_id uuid primary key references public.organizations(id) on delete cascade,
    encrypted_token text not null,
    updated_at timestamptz not null default now()
  );
  alter table public.billing_export_connections enable row level security;
  revoke all on public.billing_export_connections from public, anon, authenticated;
  grant select, insert, update, delete on public.billing_export_connections to service_role;
end;
$function$;
revoke execute on function public.fn_install_billing_export_module() from public, anon, authenticated;
grant execute on function public.fn_install_billing_export_module() to service_role;
