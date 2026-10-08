-- Gravity CRM — service identity access for tables created after the
-- original server-service bootstrap migration.
begin;

do $policies$
declare
  t text;
begin
  foreach t in array array[
    'revenue_source_baselines',
    'saas_accounts',
    'saas_account_identities',
    'revenue_subscription_states',
    'revenue_mrr_events',
    'revenue_monthly_snapshots',
    'product_health_settings',
    'product_events',
    'product_usage_states',
    'customer_action_items',
    'retention_churn_diagnoses',
    'retention_cancel_sessions',
    'retention_cancel_events',
    'organization_vertical_packs'
  ]
  loop
    execute format(
      'grant select, insert, update, delete on public.%I to authenticated',
      t
    );

    execute format(
      'drop policy if exists neon_server_service_all on public.%I',
      t
    );

    execute format(
      'create policy neon_server_service_all on public.%I for all to authenticated using (public.fn_neon_service_identity_ok()) with check (public.fn_neon_service_identity_ok())',
      t
    );
  end loop;
end
$policies$;

insert into public.neon_schema_migrations(version,note)
values(
  '20261007_0041_gravity_crm_service_identity',
  'Server-only Neon identity can operate Gravity CRM SaaS, retention and vertical-pack tables'
)
on conflict(version) do update
set applied_at=excluded.applied_at,note=excluded.note;

notify pgrst,'reload schema';
commit;
