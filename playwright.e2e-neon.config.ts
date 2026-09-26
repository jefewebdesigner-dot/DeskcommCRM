import { defineConfig } from "@playwright/test";

/**
 * Config SEPARADA de `playwright.config.ts` (raiz, Supabase local) e de
 * `tests/journeys/playwright.config.ts` (canais). Esta é a única que fala com
 * o backend Neon — e por isso é a única com `globalSetup`/`globalTeardown`
 * amarrados à guarda de `tests/e2e-neon/guarda-ambiente.ts`, que recusa rodar
 * fora da branch `homologacao` (ver esse arquivo para o contrato completo).
 *
 * NÃO sobe servidor (`webServer` ausente de propósito — pedido explícito:
 * "use o servidor já existente na porta 3591; não suba outro Next"). Se a
 * 3591 não responder, os testes falham no primeiro `page.goto`, não aqui.
 *
 * Rodar: `E2E_NEON_HOMOLOG_CONFIRMADO=1 pnpm exec playwright test -c playwright.e2e-neon.config.ts`
 */
const PORT = process.env.E2E_NEON_PORT ?? "3591";

export default defineConfig({
  testDir: "./tests/e2e-neon",
  globalSetup: "./tests/e2e-neon/global-setup.ts",
  globalTeardown: "./tests/e2e-neon/global-teardown.ts",
  timeout: 45_000,
  fullyParallel: false,
  // Um worker: VPS de 4GB, e as specs compartilham as mesmas fixtures A/B/C.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },
  projects: [{ name: "chromium-homolog", use: { browserName: "chromium" } }],
});
