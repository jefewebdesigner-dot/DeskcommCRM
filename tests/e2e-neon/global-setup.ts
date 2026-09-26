import { writeFileSync } from "node:fs";
import path from "node:path";

import { exigirAmbienteHomologacao } from "./guarda-ambiente";
import { criarFixturesABC } from "./fixtures-abc";

const ARQUIVO_FIXTURES = path.join(__dirname, ".fixtures-runtime.json");

export default async function globalSetup(): Promise<void> {
  // Primeiro passo, sempre: se a guarda recusar, nada mais roda — nem um
  // signup é feito, nem uma conexão de fixture é aberta.
  exigirAmbienteHomologacao();

  const fixtures = await criarFixturesABC();
  writeFileSync(ARQUIVO_FIXTURES, JSON.stringify(fixtures, null, 2), { mode: 0o600 });
  // eslint-disable-next-line no-console
  console.log(
    `[e2e-neon] fixtures criadas: A=${fixtures.A.userId} B=${fixtures.B.userId} C=${fixtures.C.userId} orgA=${fixtures.A.orgId} orgB=${fixtures.B.orgId}`,
  );
}
