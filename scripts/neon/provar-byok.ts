/**
 * Prova operacional da credencial de IA (BYOK) da organização, pelo MESMO caminho do worker:
 *   pool com contexto de organização → resolveOrgLlmConfig (decifra com AI_CRED_AES_KEY) → runModelCall.
 *
 *   pnpm tsx --require ./workers/agent-worker/server-only-shim.cjs --env-file=.env \
 *     scripts/neon/provar-byok.ts <organization_id> [--provider google] [--modelo <id>] [--chamar]
 *
 * Sem `--chamar` só resolve e decifra (nenhum token gasto). Com `--chamar` faz UMA chamada curta
 * real ("responda ok"), que grava a linha normal em `llm_calls`. A chave nunca é impressa — só
 * origem, provedor, formato e resultado.
 */
import { createPool } from "@/lib/agent-engine/db/pool";
import { createTenantPool } from "@/lib/agent-engine/db/tenant-pool";
import { resolveOrgLlmConfig } from "@/lib/agent-engine/edge/llm/credentials";
import { llmEdgeConfigFromEnv, runModelCall } from "@/lib/agent-engine/edge/llm/run-model-call";
import { loadEnv } from "@/lib/agent-engine/env";

const PREFIXOS: Record<string, RegExp> = {
  anthropic: /^sk-ant-/,
  openai: /^sk-/,
  openrouter: /^sk-or-/,
};

async function main(): Promise<void> {
  const org = process.argv[2];
  const chamar = process.argv.includes("--chamar");
  const flag = (nome: string): string | undefined => {
    const i = process.argv.indexOf(nome);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const provider = flag("--provider");
  const modelo = flag("--modelo");
  if (!org) throw new Error("Informe o organization_id.");
  const env = loadEnv();
  const serviceUserId = env.WORKER_SERVICE_USER_ID ?? env.NEON_SERVICE_USER_ID;
  if (!env.WORKER_DB_SECRET || !serviceUserId) throw new Error("WORKER_DB_SECRET/WORKER_SERVICE_USER_ID ausentes.");
  const raw = createPool(env.DATABASE_URL);
  const pool = createTenantPool(raw, { serviceUserId, secret: env.WORKER_DB_SECRET });
  const cfg = llmEdgeConfigFromEnv(env);
  try {
    await pool.withOrganization(org, async () => {
      const r = await resolveOrgLlmConfig(pool, cfg, org, provider ? { provider } : undefined);
      const formato = PREFIXOS[r.provider]?.test(r.apiKey) ?? null;
      console.info(
        JSON.stringify({
          etapa: "resolver",
          provider: r.provider,
          origemDaChave: r.origemDaChave,
          chaveDecifrada: r.apiKey.length > 0,
          formatoDoProvedor: formato,
          modeloPadrao: r.defaultModel,
          orcamentoModo: r.orcamento.modo,
        }),
      );
      if (!chamar) return;
      const res = await runModelCall(pool, cfg, {
        tenantId: org,
        purpose: "connection_test",
        messages: [{ role: "user", content: "Responda apenas com a palavra: ok" }],
        maxSteps: 1,
        ...(provider ? { llmOverride: { provider } } : {}),
        ...(modelo ? { model: modelo } : {}),
      });
      const r2 = res as unknown as Record<string, unknown>;
      const texto = String((r2.result as { text?: unknown } | undefined)?.text ?? r2.text ?? "").trim().slice(0, 40);
      console.info(
        JSON.stringify({
          etapa: "chamada",
          ok: texto.length > 0,
          resposta: texto,
          campos: Object.keys(r2).slice(0, 12),
          uso: r2.usage ?? null,
        }),
      );
    });
  } finally {
    await raw.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message.split("\n", 1)[0] : String(error));
  process.exit(1);
});
