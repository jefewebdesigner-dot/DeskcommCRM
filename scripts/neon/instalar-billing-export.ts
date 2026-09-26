/** Instala SOMENTE o módulo de billing deste fork, sem grants globais. */
import { readFileSync } from "node:fs";
import { Client } from "pg";

async function main() {
  if (!process.argv.includes("--apply"))
    throw new Error("Use --apply para instalar o módulo opcional.");
  const runtimeUrl = process.env.DATABASE_URL;
  const migrationUrl = process.env.MIGRATIONS_DATABASE_URL;
  if (!runtimeUrl || !migrationUrl) throw new Error("Conexões de aplicação e DDL são necessárias.");
  const runtimeHost = new URL(runtimeUrl);
  const migrationHost = new URL(migrationUrl);
  if (
    runtimeHost.hostname.replace("-pooler.", ".") !== migrationHost.hostname ||
    runtimeHost.pathname !== migrationHost.pathname
  ) {
    throw new Error("As conexões devem apontar para o mesmo banco.");
  }
  const runtime = new Client({ connectionString: runtimeUrl, connectionTimeoutMillis: 10000 });
  const ddl = new Client({ connectionString: migrationUrl, connectionTimeoutMillis: 10000 });
  try {
    await runtime.connect();
    const result = await runtime.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>("select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user");
    const role = result.rows[0];
    if (
      !role ||
      role.rolsuper ||
      role.rolbypassrls ||
      ["anon", "authenticated", "service_role"].includes(role.rolname)
    ) {
      throw new Error("A aplicação precisa de uma role própria sem superuser/BYPASSRLS.");
    }
    await ddl.connect();
    await ddl.query("BEGIN");
    await ddl.query("set local lock_timeout = '5s'");
    const owner = await ddl.query("select current_user = $1 as same_role", [role.rolname]);
    if (owner.rows[0]?.same_role) throw new Error("DDL e runtime não podem usar a mesma role.");
    await ddl.query(
      readFileSync("supabase/migrations/20260925120000_0344_billing_export_module.sql", "utf8"),
    );
    await ddl.query("select public.fn_install_billing_export_module()");
    const identifier = `"${role.rolname.replaceAll('"', '""')}"`;
    await ddl.query(
      `grant select, insert, update, delete on public.billing_export_connections to ${identifier}`,
    );
    await ddl.query(
      "drop policy if exists billing_export_runtime_tenant on public.billing_export_connections",
    );
    await ddl.query(`create policy billing_export_runtime_tenant on public.billing_export_connections for all to ${identifier}
      using (organization_id = nullif(current_setting('app.billing_export_org', true), '')::uuid)
      with check (organization_id = nullif(current_setting('app.billing_export_org', true), '')::uuid)`);
    await ddl.query(`insert into public.neon_schema_migrations(version, note)
      values ('20260925_0005_billing_export_module', 'Optional billing export; runtime-only grant scoped by transaction tenant; canonical migration 0344')
      on conflict (version) do nothing`);
    await ddl.query("COMMIT");
    // Only status, never connection strings, tokens or records.
    console.info(
      "billing_export: schema instalado; RLS transacional; nenhum grant global alterado.",
    );
  } catch {
    await ddl.query("ROLLBACK").catch(() => undefined);
    throw new Error(
      "Instalação de billing não concluída. Nenhuma credencial foi registrada em log.",
    );
  } finally {
    await runtime.end();
    await ddl.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Instalação não concluída.");
  process.exitCode = 1;
});
