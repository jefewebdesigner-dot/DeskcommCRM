import { test, expect } from "@playwright/test";
import { Client } from "pg";
import { execFileSync } from "node:child_process";
import { lerFixturesABC } from "./ler-fixtures";
import { signInCookie } from "./cliente-neon-auth";
import {
  normalizeOther,
  normalizeStripe,
  type BillingDashboard,
} from "../../lib/billing-export/contracts";
import { stripeBillingFixture, otherBillingFixture } from "../fixtures/billing-export";

test.use({ trace: "off", actionTimeout: 45000 });

test("billing: RLS runtime nega leitura cruzada, escrita cruzada e contexto ausente", async () => {
  const { A, B } = lerFixturesABC();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("select set_config('app.billing_export_org', $1, true)", [A.orgId]);
    await client.query(
      "insert into public.billing_export_connections (organization_id, encrypted_token) values ($1, $2)",
      [A.orgId, "synthetic-ciphertext-not-a-credential"],
    );
    await client.query("COMMIT");
    // A conexão limpa perde o contexto, inclusive depois de COMMIT.
    expect(
      (await client.query("select organization_id from public.billing_export_connections"))
        .rowCount,
    ).toBe(0);
    await client.query("BEGIN");
    await client.query("select set_config('app.billing_export_org', $1, true)", [B.orgId]);
    expect(
      (
        await client.query(
          "select organization_id from public.billing_export_connections where organization_id=$1",
          [A.orgId],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await client.query(
          "delete from public.billing_export_connections where organization_id=$1",
          [A.orgId],
        )
      ).rowCount,
    ).toBe(0);
    await client.query("SAVEPOINT cross_write");
    await expect(
      client.query(
        "insert into public.billing_export_connections (organization_id, encrypted_token) values ($1,'denied') on conflict (organization_id) do update set encrypted_token='denied'",
        [A.orgId],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await client.query("ROLLBACK TO SAVEPOINT cross_write");
    await client.query("COMMIT");
    await client.query("BEGIN");
    await client.query("select set_config('app.billing_export_org', $1, true)", [A.orgId]);
    const persisted = await client.query(
      "select encrypted_token from public.billing_export_connections where organization_id=$1",
      [A.orgId],
    );
    expect(persisted.rows[0].encrypted_token).toBe("synthetic-ciphertext-not-a-credential");
    await client.query("delete from public.billing_export_connections where organization_id=$1", [
      A.orgId,
    ]);
    await client.query("COMMIT");
    // Exercita os helpers reais de cifra/persistência em dois processos: reler
    // não pode depender de cache em memória. Credencial inteiramente sintética.
    const loader = `const Module=require('node:module'); const original=Module._load; Module._load=function(id,...args){if(id==='server-only')return {};return original.call(this,id,...args)};`;
    const save = `${loader} const {saveConnection}=require('./lib/billing-export/config'); void saveConnection('${A.orgId}', 'synthetic-persisted-token').then(()=>process.exit(0)).catch(()=>process.exit(1));`;
    const read = `${loader} const {readConnection,removeConnection}=require('./lib/billing-export/config'); void (async()=>{const value=await readConnection('${A.orgId}');if(value?.token!=='synthetic-persisted-token')process.exit(1);await removeConnection('${A.orgId}');process.exit(0)})().catch(()=>process.exit(1));`;
    for (const source of [save, read])
      execFileSync("pnpm", ["exec", "tsx", "--conditions=react-server", "-e", source], {
        stdio: "pipe",
        timeout: 30000,
      });

    // Um JWT comum não consegue ler cifra nem executar o provisionador via Data API.
    const cookie = await signInCookie(A.email, A.password);
    const authBase = process.env.NEON_AUTH_BASE_URL!.replace(/\/$/, "");
    const tokenResponse = await fetch(`${authBase}/token`, {
      headers: { cookie, origin: new URL(authBase).origin },
    });
    expect(tokenResponse.ok).toBe(true);
    const { token } = (await tokenResponse.json()) as { token: string };
    const base = process.env.NEON_DATA_API_URL!.replace(/\/$/, "");
    const acl = await client.query(`select
      has_table_privilege('authenticated', 'public.billing_export_connections', 'SELECT') as can_read,
      has_table_privilege('authenticated', 'public.billing_export_connections', 'INSERT') as can_write,
      has_function_privilege('authenticated', 'public.fn_install_billing_export_module()', 'EXECUTE') as can_install`);
    expect(acl.rows[0]).toEqual({ can_read: false, can_write: false, can_install: false });
    for (const [path, method] of [
      ["billing_export_connections?select=organization_id", "GET"],
      ["rpc/fn_install_billing_export_module", "POST"],
    ]) {
      const response = await fetch(`${base}/${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(method === "POST" ? { body: "{}" } : {}),
      });
      const body = (await response.json()) as { code?: string };
      expect(response.ok).toBe(false);
      // Neon também omite objetos sem grants do schema REST (205/202).
      // A ACL acima prova a recusa; 404 isolado não seria prova de isolamento.
      expect(["42501", "PGRST205", "PGRST202"]).toContain(body.code);
    }
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("billing: sessão real, organização da aba e painel desktop/mobile com fonte sintética", async ({
  page,
  request,
}, info) => {
  test.setTimeout(240000);
  const { A, B } = lerFixturesABC();
  expect((await request.get("/api/v1/billing-export")).status()).toBe(401);
  await page.goto("/login?next=/app/assinaturas", { timeout: 60000 });
  await page.getByLabel("Email").fill(A.email);
  await page.getByLabel("Senha").fill(A.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/app/assinaturas", { timeout: 90000 });
  await expect(
    page.getByRole("heading", { name: "Clientes e assinaturas", exact: true }),
  ).toBeVisible({ timeout: 45000 });
  await expect(page.getByRole("heading", { name: "Conecte os dados da PeríciaIA" })).toBeVisible({
    timeout: 45000,
  });
  const own = await page.request.get("/api/v1/billing-export", {
    headers: { "X-Organization-Id": A.orgId! },
  });
  expect(own.status()).toBe(200);
  expect(await own.json()).toMatchObject({ data: { configured: false } });
  for (const method of ["GET", "DELETE", "PUT"]) {
    const response = await page.request.fetch("/api/v1/billing-export", {
      method,
      headers: { "X-Organization-Id": B.orgId! },
      ...(method === "PUT" ? { data: { token: "synthetic-token-not-used" } } : {}),
    });
    expect(response.status()).toBe(409);
  }

  const dashboard: BillingDashboard = {
    fetched_at: "2026-09-25T12:00:00Z",
    stripe: { ok: true, data: normalizeStripe(stripeBillingFixture) },
    other: { ok: true, data: normalizeOther(otherBillingFixture) },
  };
  await page.route("**/api/v1/billing-export", async (route) =>
    route.fulfill({ json: { data: { configured: true, dashboard } } }),
  );
  await page.reload({ timeout: 60000 });
  await expect(page.getByText("Cliente sintético PIX", { exact: true })).toBeVisible({
    timeout: 45000,
  });
  await page.getByLabel("Situação da assinatura").selectOption("active");
  await expect(page.getByText("Nenhuma assinatura corresponde aos filtros.")).toBeVisible();
  await page.getByLabel("Situação da assinatura").selectOption("past_due");
  await expect(page.getByText("Cliente sintético PIX", { exact: true })).toBeVisible();
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await info.attach(`billing-${width}`, {
      body: await page.screenshot({
        path: info.outputPath(`billing-${width}.png`),
        fullPage: true,
      }),
      contentType: "image/png",
    });
  }
  await page.getByRole("button", { name: "Pagamentos", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pagamentos recentes · Stripe" })).toBeVisible();
  await page.getByRole("button", { name: "Renovações Stripe", exact: true }).click();
  await expect(page.getByText("Cancelamento programado", { exact: true }).last()).toBeVisible();
  await page.unroute("**/api/v1/billing-export");
  await page.route("**/api/v1/billing-export", async (route) =>
    route.fulfill({
      json: {
        data: {
          configured: true,
          dashboard: { ...dashboard, stripe: { ok: false, error: "unavailable" } },
        },
      },
    }),
  );
  await page.getByRole("button", { name: "Atualizar dados" }).click();
  await expect(page.getByText("Stripe indisponível.", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Indicadores PIX e manual" })).toBeVisible();
  await page.unroute("**/api/v1/billing-export");
  await page.route("**/api/v1/billing-export", async (route) =>
    route.fulfill({ status: 503, json: { error: { message: "Falha sintética de recuperação" } } }),
  );
  await page.getByRole("button", { name: "Atualizar dados" }).click();
  await expect(page.getByText("Falha sintética de recuperação", { exact: false })).toBeVisible();
});
