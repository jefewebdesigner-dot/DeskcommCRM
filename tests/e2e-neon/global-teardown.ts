import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";

import { exigirAmbienteHomologacao } from "./guarda-ambiente";

import { limparFixturesABC, type FixturesABC } from "./fixtures-abc";

const ARQUIVO_FIXTURES = path.join(__dirname, ".fixtures-runtime.json");

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(ARQUIVO_FIXTURES)) {
    // eslint-disable-next-line no-console
    console.log(
      "[e2e-neon] nada para limpar — fixtures nunca foram criadas (guarda deve ter recusado antes).",
    );
    return;
  }
  exigirAmbienteHomologacao();
  const fixtures = JSON.parse(readFileSync(ARQUIVO_FIXTURES, "utf8")) as FixturesABC;
  await limparFixturesABC(fixtures);
  unlinkSync(ARQUIVO_FIXTURES);
  // eslint-disable-next-line no-console
  console.log("[e2e-neon] fixtures A/B/C removidas (orgs + usuários sintéticos).");
}
