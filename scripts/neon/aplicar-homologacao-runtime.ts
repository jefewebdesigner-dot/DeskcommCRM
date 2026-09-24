import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import { Client } from "pg";

const ROOT = process.cwd();
const AUDIT_PATH = path.join(
  ROOT,
  "docs",
  "audits",
  "neon-supabase-2026-09-23",
  "gravity-neon-metadata.json",
);

const MIGRATIONS = [
  "20260923_0003_data_api_grants.sql",
  "20260923_0004_server_service_identity.sql",
] as const;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} ausente.`);
  return value;
}

function hostOf(url: string): string {
  return new URL(url).hostname;
}

function parseCookies(res: Response): string {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const all =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(
          (value): value is string => !!value,
        );
  return all
    .map((value) => value.split(";", 1)[0]?.trim())
    .filter((value): value is string => !!value)
    .join("; ");
}

async function loginServiceIdentity() {
  const base = required("NEON_AUTH_BASE_URL").replace(/\/+$/, "");
  const origin = "https://gravityia.tech";
  const response = await fetch(`${base}/sign-in/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({
      email: required("NEON_SERVICE_EMAIL"),
      password: required("NEON_SERVICE_PASSWORD"),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(
      `Login da identidade técnica falhou: HTTP ${response.status}.`,
    );
  }

  const cookie = parseCookies(response);
  if (!cookie) {
    throw new Error("Neon Auth não devolveu cookie para a identidade técnica.");
  }

  const tokenRes = await fetch(`${base}/token`, {
    method: "GET",
    headers: { cookie, origin },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokenRes.ok) {
    throw new Error(
      `Token da identidade técnica falhou: HTTP ${tokenRes.status}.`,
    );
  }
  const body = (await tokenRes.json()) as { token?: string };
  if (!body.token) throw new Error("JWT da identidade técnica ausente.");
  return body.token;
}

async function main() {
  const stage = required("NEON_BRANCH");
  if (stage !== "homologacao") {
    throw new Error(
      `Deploy recusado: NEON_BRANCH=${stage}. Este script só roda em homologacao.`,
    );
  }

  const projectId = required("NEON_PROJECT_ID");
  const databaseUrl = required("DATABASE_URL");
  const migrationsUrl = required("MIGRATIONS_DATABASE_URL");
  const serviceUserId = required("NEON_SERVICE_USER_ID");
  const dataApiUrl = required("NEON_DATA_API_URL").replace(/\/+$/, "");

  if (!fs.existsSync(AUDIT_PATH)) {
    throw new Error(
      "Metadado sanitizado do Gravity ausente; não é possível comprovar o destino.",
    );
  }

  const metadata = JSON.parse(fs.readFileSync(AUDIT_PATH, "utf8")) as {
    projectId?: string;
    branchId?: string;
    branchName?: string;
    endpointHost?: string;
    endpointMatched?: boolean;
  };

  const appHost = hostOf(databaseUrl);
  const migrationHost = hostOf(migrationsUrl);
  const branchProof =
    metadata.projectId === projectId &&
    metadata.branchName === "homologacao" &&
    metadata.endpointMatched === true &&
    !!metadata.branchId &&
    metadata.endpointHost === appHost &&
    appHost === migrationHost;

  if (!branchProof) {
    throw new Error(
      "Comprovação da branch de homologação falhou; nenhuma migration foi aplicada.",
    );
  }

  const migration = new Client({
    connectionString: migrationsUrl,
    connectionTimeoutMillis: 10_000,
  });

  await migration.connect();
  try {
    const current = await migration.query<{
      role: string;
      database: string;
    }>("select current_user as role, current_database() as database");

    const appRole = decodeURIComponent(new URL(databaseUrl).username);
    const migrationRole = decodeURIComponent(new URL(migrationsUrl).username);

    if (appRole === migrationRole) {
      throw new Error("Role de aplicação e role de migrations são iguais.");
    }
    if (current.rows[0]?.role !== migrationRole) {
      throw new Error("A conexão de migration não usa a role esperada.");
    }

    const appAttrs = await migration.query<{
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolbypassrls: boolean;
    }>(
      `
        select rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
        from pg_roles
        where rolname = $1
      `,
      [appRole],
    );
    const attrs = appAttrs.rows[0];
    if (
      !attrs ||
      attrs.rolsuper ||
      attrs.rolcreatedb ||
      attrs.rolcreaterole ||
      attrs.rolbypassrls
    ) {
      throw new Error("Role da aplicação possui privilégio administrativo indevido.");
    }

    const canCreatePublic = await migration.query<{ ok: boolean }>(
      "select has_schema_privilege($1, 'public', 'CREATE') as ok",
      [appRole],
    );
    if (canCreatePublic.rows[0]?.ok) {
      throw new Error("Role da aplicação possui CREATE no schema public.");
    }

    const existing = await migration.query<{ version: string }>(
      "select version from public.neon_schema_migrations",
    );
    const applied = new Set(existing.rows.map((row) => row.version));
    const newlyApplied: string[] = [];

    for (const filename of MIGRATIONS) {
      const version = filename.replace(/\.sql$/, "");
      if (applied.has(version)) continue;

      const sqlPath = path.join(ROOT, "neon", "migrations", filename);
      const sql = fs.readFileSync(sqlPath, "utf8");
      await migration.query(sql);
      newlyApplied.push(version);
    }

    const authUser = await migration.query<{ ok: boolean }>(
      `
        select exists(
          select 1
          from neon_auth."user"
          where id = $1::uuid
        ) as ok
      `,
      [serviceUserId],
    );
    if (!authUser.rows[0]?.ok) {
      throw new Error(
        "Identidade técnica não existe no Neon Auth; registro foi interrompido.",
      );
    }

    await migration.query(
      `
        insert into public.neon_service_identities(user_id, kind, active)
        values ($1::uuid, 'server', true)
        on conflict (user_id)
        do update set active = true
      `,
      [serviceUserId],
    );

    const serviceToken = await loginServiceIdentity();
    const apiRes = await fetch(
      `${dataApiUrl}/organizations?select=id&limit=5`,
      {
        headers: {
          authorization: `Bearer ${serviceToken}`,
          "accept-profile": "public",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!apiRes.ok) {
      throw new Error(
        `Data API com identidade técnica falhou: HTTP ${apiRes.status}.`,
      );
    }

    const visible = (await apiRes.json()) as unknown[];
    const finalMigrations = await migration.query<{ version: string }>(
      `
        select version
        from public.neon_schema_migrations
        where version = any($1::text[])
        order by version
      `,
      [MIGRATIONS.map((name) => name.replace(/\.sql$/, ""))],
    );

    console.info(
      JSON.stringify(
        {
          ok: true,
          environment: "homologacao",
          projectId,
          branchId: metadata.branchId,
          branchName: metadata.branchName,
          endpointMatched: true,
          database: current.rows[0]?.database ?? null,
          roles: {
            separated: true,
            appRestricted: true,
            appCanCreatePublicSchemaObjects: false,
          },
          migrations: {
            newlyApplied,
            confirmed: finalMigrations.rows.map((row) => row.version),
          },
          serviceIdentity: {
            registered: true,
            authLogin: true,
            dataApiAccess: true,
            visibleOrganizationCount: Array.isArray(visible)
              ? visible.length
              : 0,
          },
          productionChanged: false,
          secretsPrinted: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await migration.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(
    "NEON_HOMOLOG_RUNTIME_DEPLOY_FAILED=" +
      (error instanceof Error ? error.message : String(error)),
  );
  process.exit(1);
});
