import { test, expect } from "@playwright/test";

import { lerFixturesABC } from "./ler-fixtures";

test.describe("smoke — servidor vivo, tela renderiza, login real funciona", () => {
  test("health responde", async ({ request }) => {
    const r = await request.get("/api/v1/health");
    expect(r.status()).toBeLessThan(500);
    const body = await r.json();
    expect(body.data.checks.neon.status).toBe("ok");
  });

  test("tela de login renderiza com CSS aplicado", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Senha")).toBeVisible();
    const botao = page.getByRole("button", { name: "Entrar" });
    await expect(botao).toBeVisible();

    // Prova de CSS real (não só presença do elemento): um <button> sem
    // Tailwind não tem largura 100% nem padding vertical — isto falharia
    // exatamente no estado "sem estilo" que apareceu no preview antes.
    const box = await botao.boundingBox();
    expect(box).not.toBeNull();
    const largura = await page.evaluate(() => document.querySelector("form")?.clientWidth ?? 0);
    expect(box!.width).toBeGreaterThan(largura * 0.8);
  });

  test("login real do usuário A mantém acesso autenticado após recarregar", async ({
    page,
  }, testInfo) => {
    // O servidor dev existente compila o destino no primeiro acesso.
    test.setTimeout(120_000);
    const { A } = lerFixturesABC();
    await page.goto("/login?next=/app/contacts");
    await page.getByLabel("Email").fill(A.email);
    await page.getByLabel("Senha").fill(A.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL((url) => url.pathname === "/app/contacts", { timeout: 60_000 });
    await page.reload({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/app\//);
    await expect(page.getByRole("heading", { name: "Contatos", exact: true })).toBeVisible();
    const resposta = await page.request.get("/api/v1/contacts?limit=1");
    expect(resposta.status()).toBe(200);
    await expect(page.getByText("Nenhum contato ainda", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await testInfo.attach("sessao-autenticada", {
      body: await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath("sessao-autenticada.png"),
      }),
      contentType: "image/png",
    });
  });
});
