/**
 * Trava de segurança da suíte E2E-Neon — SEPARADA da trava do
 * `playwright.config.ts` da raiz (que continua intacta, exigindo Supabase
 * local). Esta aqui existe porque este projeto migrou pra backend Neon e
 * aquela trava não sabe validar branch Neon nenhuma.
 *
 * Contrato inegociável (pedido explícito, 2026-09-24):
 *  1. Só roda com opt-in explícito (`E2E_NEON_HOMOLOG_CONFIRMADO=1`).
 *  2. Confirma que a conexão é a branch `homologacao`, não `main`.
 *  3. Recusa por padrão — allowlist, não denylist. Qualquer host que não
 *     seja EXATAMENTE o de homologacao é recusado, `main` incluída, e
 *     qualquer host desconhecido também (nunca adivinha).
 *  4. Nunca usa credencial/dado de cliente real — só cria dado sintético
 *     com prefixo reconhecível (ver `PREFIXO_FIXTURE`).
 *
 * O host abaixo foi confirmado de forma independente em 2026-09-24 via API
 * de gerência do Neon (GET /projects/{id}/branches + /endpoints), não por
 * suposição: `ep-crimson-mode-b5cecqiz` é o endpoint de `br-jolly-fog-b5vafsas`
 * ("homologacao", primary=false, parent=main). Trocar a branch de
 * homologação exige atualizar esta constante deliberadamente — allowlist que
 * não é mantida é allowlist que mente.
 */

const HOST_HOMOLOGACAO_PERMITIDO = "ep-crimson-mode-b5cecqiz.c-7.us-east-2.aws.neon.tech";
const HOST_POOLER_PERMITIDO = "ep-crimson-mode-b5cecqiz-pooler.c-7.us-east-2.aws.neon.tech";
const HOST_AUTH_PERMITIDO = "ep-crimson-mode-b5cecqiz.neonauth.c-7.us-east-2.aws.neon.tech";
const HOST_DATA_API_PERMITIDO = "ep-crimson-mode-b5cecqiz.apirest.c-7.us-east-2.aws.neon.tech";

/** Prefixo de TODO dado sintético criado por esta suíte — é o que a limpeza usa pra saber o que é seu. */
export const PREFIXO_FIXTURE = "e2e-neon-homolog";

type Diagnostico = {
  ok: boolean;
  motivo: string;
  hostDatabaseUrl: string;
  hostMigrationsUrl: string;
};

function hostDe(urlBruta: string | undefined, nomeVar: string): string {
  if (!urlBruta) throw new Error(`GUARDA E2E-NEON: ${nomeVar} ausente — recusado.`);
  let host: string;
  try {
    host = new URL(urlBruta).hostname;
  } catch {
    throw new Error(`GUARDA E2E-NEON: ${nomeVar} não é uma URL válida — recusado.`);
  }
  return host;
}

/**
 * Verifica e retorna o diagnóstico. NUNCA retorna `ok: true` sem ambos os
 * hosts baterem EXATAMENTE com os endpoints de homologação. Também valida
 * Auth e Data API para não criar usuários ou consultar dados em outra branch.
 */
export function diagnosticarAmbiente(): Diagnostico {
  const hostApp = hostDe(process.env.DATABASE_URL, "DATABASE_URL");
  const hostMigrations = hostDe(process.env.MIGRATIONS_DATABASE_URL, "MIGRATIONS_DATABASE_URL");

  if (process.env.E2E_NEON_HOMOLOG_CONFIRMADO !== "1") {
    return {
      ok: false,
      motivo:
        "opt-in ausente: defina E2E_NEON_HOMOLOG_CONFIRMADO=1 explicitamente para rodar esta suíte.",
      hostDatabaseUrl: hostApp,
      hostMigrationsUrl: hostMigrations,
    };
  }

  const appBate = [HOST_HOMOLOGACAO_PERMITIDO, HOST_POOLER_PERMITIDO].includes(hostApp);
  const migrationsBate = hostMigrations === HOST_HOMOLOGACAO_PERMITIDO;
  const authBate =
    hostDe(process.env.NEON_AUTH_BASE_URL, "NEON_AUTH_BASE_URL") === HOST_AUTH_PERMITIDO;
  const dataApiBate =
    hostDe(process.env.NEON_DATA_API_URL, "NEON_DATA_API_URL") === HOST_DATA_API_PERMITIDO;

  if (!appBate || !migrationsBate || !authBate || !dataApiBate) {
    return {
      ok: false,
      motivo:
        `host observado não é a branch homologacao permitida (esperado endpoint "${HOST_HOMOLOGACAO_PERMITIDO}"). ` +
        `Isto inclui main/produção e qualquer branch não cadastrada aqui — recusado por padrão, sem exceção.`,
      hostDatabaseUrl: hostApp,
      hostMigrationsUrl: hostMigrations,
    };
  }

  return {
    ok: true,
    motivo: "branch homologacao confirmada.",
    hostDatabaseUrl: hostApp,
    hostMigrationsUrl: hostMigrations,
  };
}

/** Usado no globalSetup: lança e ABORTA a suíte inteira se a guarda não passar. */
export function exigirAmbienteHomologacao(): void {
  const d = diagnosticarAmbiente();
  // eslint-disable-next-line no-console
  console.log(
    `[guarda-e2e-neon] host DATABASE_URL=${d.hostDatabaseUrl} host MIGRATIONS_DATABASE_URL=${d.hostMigrationsUrl} ok=${d.ok}`,
  );
  if (!d.ok) {
    throw new Error(`GUARDA E2E-NEON RECUSOU A EXECUÇÃO: ${d.motivo}`);
  }
}
