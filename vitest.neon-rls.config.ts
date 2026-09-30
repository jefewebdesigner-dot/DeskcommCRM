import path from "node:path";

import { defineConfig } from "vitest/config";

/**
 * Provas de banco REAL do contexto de organização do agent-worker (tests/neon-rls).
 *
 * Fora da suíte comum (`vitest.config.ts` as exclui): precisam do harness Docker
 * (`scripts/neon/rls-harness.sh`) e importam o motor inteiro, que arrasta o cliente Neon Auth. Aqui
 * o pacote é resolvido pelo Vite (inline) e `next/headers` aponta para o do projeto, como acontece
 * no build do Next e no runtime do worker (tsx).
 *
 *   eval "$(scripts/neon/rls-harness.sh url | sed 's/^/export /')" && pnpm test:rls-worker
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/neon-rls/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    setupFiles: ["./tests/setup/vitest.setup.ts"], // placeholders das envs que lib/env.ts exige no import
    globals: true,
    fileParallelism: false,
    server: { deps: { inline: [/@neondatabase\//] } },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "node_modules/next/dist/compiled/server-only/empty.js"),
      "next/headers": path.resolve(__dirname, "node_modules/next/headers.js"),
    },
  },
});
