import { readFileSync } from "node:fs";
import path from "node:path";

import type { FixturesABC } from "./fixtures-abc";

const ARQUIVO_FIXTURES = path.join(__dirname, ".fixtures-runtime.json");

/** Lê as fixtures escritas pelo globalSetup. Cada spec/worker chama isto, não recria nada. */
export function lerFixturesABC(): FixturesABC {
  return JSON.parse(readFileSync(ARQUIVO_FIXTURES, "utf8")) as FixturesABC;
}
