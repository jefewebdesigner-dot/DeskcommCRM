import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const fixture = "/docs/audits/runtime-2026-09-24/readiness/emoji/browser-fixture.tsx";
const cacheDir = await mkdtemp(path.join(tmpdir(), "emoji-review-vite-"));
let markup;
const server = await createServer({
  configFile: false, root, envDir: false, cacheDir,
  resolve: { alias: { "@": root } },
  server: { host: "127.0.0.1", port: 0 },
  plugins: [{ name: "isolated-emoji-review", configureServer(vite) {
    vite.middlewares.use("/emoji-review", async (_req, res, next) => {
      try {
        const html = await vite.transformIndexHtml("/emoji-review", `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Emoji review</title></head><body><div id="root">${markup}</div><script type="module" src="${fixture}"></script></body></html>`);
        res.setHeader("Content-Type", "text/html"); res.end(html);
      } catch (error) { next(error); }
    });
  } }],
});
let browser;
try {
  const { Fixture } = await server.ssrLoadModule(fixture);
  markup = renderToString(createElement(Fixture));
  await server.listen();
  const address = server.httpServer.address();
  const base = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = []; const external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== base) {
      external.push(new URL(route.request().url()).origin);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(`${base}/emoji-review`);
  await expect(page.getByRole("button", { name: "Emoji", exact: true })).toBeVisible();
  await expect(page.locator("em-emoji-picker")).toHaveCount(0);
  await page.getByRole("button", { name: "Emoji", exact: true }).click();
  const emoji = page.locator("em-emoji-picker button[data-emoji-id='grinning']");
  await expect(emoji.first()).toBeVisible({ timeout: 30000 });
  // Callback muda com picker aberto; selecionar precisa usar a revisão nova.
  // Clique programático evita fechar o popover pelo outside click de Radix.
  await page.getByRole("button", { name: "Trocar callback" }).evaluate((el) => el.click());
  await expect(page.getByLabel("Revisão")).toHaveText("2");
  await emoji.first().click();
  await expect(page.getByRole("textbox", { name: "Mensagem" })).toHaveValue("2:😀");
  await page.screenshot({ path: path.join(here, "emoji-browser.png"), fullPage: true });
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Escape");
    await expect(page.locator("em-emoji-picker")).toHaveCount(0);
    await page.getByRole("button", { name: "Emoji", exact: true }).click();
    await expect(emoji.first()).toBeVisible();
    await expect(page.locator("em-emoji-picker")).toHaveCount(1);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator("em-emoji-picker")).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  const result = { status: "passed", scope: "isolated candidate, React + Radix + real emoji-mart, SSR/hydration, Chromium", checks: ["lazy mount", "latest callback", "native emoji", "5 reopen cycles", "disconnect", "no browser errors", "no external requests"], excludes: ["Next production build", "authenticated inbox", "sending messages", "heap leak profiling", "mobile browsers"] };
  await writeFile(path.join(here, "browser-result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
