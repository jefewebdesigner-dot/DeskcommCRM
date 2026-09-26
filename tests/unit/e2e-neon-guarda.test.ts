import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diagnosticarAmbiente } from "../e2e-neon/guarda-ambiente";

const endpoint = "ep-crimson-mode-b5cecqiz";
const regiao = "c-7.us-east-2.aws.neon.tech";

describe("guarda E2E Neon", () => {
  beforeEach(() => {
    vi.stubEnv("E2E_NEON_HOMOLOG_CONFIRMADO", "1");
    vi.stubEnv("DATABASE_URL", `postgresql://fixture@${endpoint}-pooler.${regiao}/fixture`);
    vi.stubEnv("MIGRATIONS_DATABASE_URL", `postgresql://fixture@${endpoint}.${regiao}/fixture`);
    vi.stubEnv("NEON_AUTH_BASE_URL", `https://${endpoint}.neonauth.${regiao}/neondb/auth`);
    vi.stubEnv("NEON_DATA_API_URL", `https://${endpoint}.apirest.${regiao}/neondb/rest/v1`);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("aceita os endpoints exatos de homologação com opt-in", () => {
    expect(diagnosticarAmbiente().ok).toBe(true);
  });
  it("recusa sem opt-in", () => {
    vi.stubEnv("E2E_NEON_HOMOLOG_CONFIRMADO", "");
    expect(diagnosticarAmbiente().ok).toBe(false);
  });
  it.each(["DATABASE_URL", "MIGRATIONS_DATABASE_URL", "NEON_AUTH_BASE_URL", "NEON_DATA_API_URL"])(
    "recusa %s de outra branch ou domínio que imita o prefixo",
    (key) => {
      for (const host of [
        "main.example.test",
        `${endpoint}.example.test`,
        `${endpoint}.${regiao}.example.test`,
      ]) {
        vi.stubEnv(key, `https://${host}/fixture`);
        expect(diagnosticarAmbiente().ok).toBe(false);
      }
    },
  );
  it.each(["DATABASE_URL", "MIGRATIONS_DATABASE_URL", "NEON_AUTH_BASE_URL", "NEON_DATA_API_URL"])(
    "recusa %s ausente ou inválida",
    (key) => {
      for (const valor of ["", "invalida"]) {
        vi.stubEnv(key, valor);
        expect(() => diagnosticarAmbiente()).toThrow(/GUARDA E2E-NEON/);
      }
    },
  );
});
