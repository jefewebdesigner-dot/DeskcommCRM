import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import { Client } from "pg";

const ROOT = process.cwd();
const MIGRATIONS = [
  "20261007_0038_gravity_crm_saas_core.sql",
  "20261007_0039_gravity_crm_retention.sql",
  "20261007_0040_vertical_packs.sql",
  "20261007_0041_gravity_crm_service_identity.sql",
  "20261007_0042_gravity_crm_default_branding.sql",
] as const;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} ausente.`);
  return value;
}

function roleFrom(url: string): string {
  return decodeURIComponent(new URL(url).username);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const appUrl = required("DATABASE_URL");
  const migrationsUrl = required("MIGRATIONS_DATABASE_URL");
  const appRole = roleFrom(appUrl);
  const migrationRole = roleFrom(migrationsUrl);

  if (!appRole || !migrationRole) throw new Error("Role de banco ausente na URL.");
  if (appRole === migrationRole) {
    throw new Error("DATABASE_URL e MIGRATIONS_DATABASE_URL usam a mesma role.");
  }

  const client = new Client({
    connectionString: migrationsUrl,
    connectionTimeoutMillis: 10_000,
  });

  await client.connect();
  try {
    const current = await client.query<{ role: string; database: string }>(
      "select current_user as role, current_database() as database",
    );
    if (current.rows[0]?.role !== migrationRole) {
      throw new Error("A conexão DDL não usa a role declarada em MIGRATIONS_DATABASE_URL.");
    }

    const ledger = await client.query<{ installed: boolean }>(
      "select to_regclass('public.neon_schema_migrations') is not null as installed",
    );
    if (!ledger.rows[0]?.installed) {
      throw new Error(
        "neon_schema_migrations ausente. A base Neon precisa estar instalada antes do SaaS Core.",
      );
    }

    const existing = await client.query<{ version: string }>(
      "select version from public.neon_schema_migrations",
    );
    const applied = new Set(existing.rows.map((row) => row.version));
    const pending = MIGRATIONS.filter(
      (file) => !applied.has(file.replace(/\.sql$/, "")),
    );

    if (!apply) {
      console.info(
        JSON.stringify(
          {
            ok: true,
            mode: "dry-run",
            database: current.rows[0]?.database ?? null,
            rolesSeparated: true,
            pending,
            command: "pnpm neon:instalar-gravity-crm -- --apply",
            secretsPrinted: false,
          },
          null,
          2,
        ),
      );
      return;
    }

    const newlyApplied: string[] = [];
    for (const filename of pending) {
      const sqlPath = path.join(ROOT, "neon", "migrations", filename);
      if (!fs.existsSync(sqlPath)) throw new Error(`Migration ausente: ${filename}`);
      const sql = fs.readFileSync(sqlPath, "utf8");
      await client.query(sql);
      newlyApplied.push(filename.replace(/\.sql$/, ""));
    }

    const expectedTables = [
      "revenue_source_baselines",
      "saas_accounts",
      "saas_account_identities",
      "revenue_subscription_states",
      "revenue_mrr_events",
      "revenue_monthly_snapshots",
      "product_health_settings",
      "product_events",
      "product_usage_states",
      "customer_action_items",
      "retention_churn_diagnoses",
      "retention_cancel_sessions",
      "retention_cancel_events",
      "organization_vertical_packs",
    ];

    const tables = await client.query<{ name: string; installed: boolean }>(
      `
        select name, to_regclass('public.' || name) is not null as installed
        from unnest($1::text[]) as name
        order by name
      `,
      [expectedTables],
    );
    const missingTables = tables.rows
      .filter((row) => !row.installed)
      .map((row) => row.name);
    if (missingTables.length) {
      throw new Error(
        "Instalação incompleta; tabelas ausentes: " + missingTables.join(", "),
      );
    }

    const expectedFunctions = [
      "fn_reconcile_saas_contact_identity",
      "fn_resolve_saas_account",
      "fn_ingest_revenue_observation",
      "fn_ingest_product_event",
      "fn_ingest_retention_cancel_event",
    ];

    const functions = await client.query<{ name: string; installed: boolean }>(
      `
        select name, exists(
          select 1
          from pg_proc p
          join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname=name
        ) as installed
        from unnest($1::text[]) as name
        order by name
      `,
      [expectedFunctions],
    );
    const missingFunctions = functions.rows
      .filter((row) => !row.installed)
      .map((row) => row.name);
    if (missingFunctions.length) {
      throw new Error(
        "Instalação incompleta; RPCs ausentes: " + missingFunctions.join(", "),
      );
    }

    const versions = MIGRATIONS.map((name) => name.replace(/\.sql$/, ""));
    const confirmed = await client.query<{ version: string }>(
      `
        select version
        from public.neon_schema_migrations
        where version = any($1::text[])
        order by version
      `,
      [versions],
    );
    if (confirmed.rows.length !== versions.length) {
      throw new Error("Ledger Neon não confirmou todas as migrations do Gravity CRM.");
    }

    const packTable = await client.query<{ installed: boolean }>(
      "select to_regclass('public.organization_vertical_packs') is not null as installed",
    );
    let periciaiaPack: string | null = null;
    if (packTable.rows[0]?.installed) {
      const pack = await client.query<{ status: string }>(
        `
          select status
          from public.organization_vertical_packs
          where organization_id='9563e071-406b-4db2-aaa4-d08846d3267b'::uuid
            and pack_id='periciaia'
          limit 1
        `,
      );
      periciaiaPack = pack.rows[0]?.status ?? null;
    }

    console.info(
      JSON.stringify(
        {
          ok: true,
          mode: "apply",
          database: current.rows[0]?.database ?? null,
          rolesSeparated: true,
          newlyApplied,
          confirmed: confirmed.rows.map((row) => row.version),
          tablesVerified: expectedTables.length,
          functionsVerified: expectedFunctions.length,
          periciaiaPack,
          secretsPrinted: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(
    "GRAVITY_CRM_NEON_INSTALL_FAILED=" +
      (error instanceof Error ? error.message : String(error)),
  );
  process.exit(1);
});
