// TEMPORÁRIA — prova de qual banco o runtime de produção usa. Será removida logo
// depois da comparação. Só devolve prefixos de SHA-256, nunca o valor das
// variáveis, e exige o mesmo segredo interno dos crons.
import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { Client } from "pg";

import { fail, ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const prefixo = (valor: string | null | undefined): string | null =>
  valor ? createHash("sha256").update(valor).digest("hex").slice(0, 12) : null;
const semAspas = (valor: string): string => valor.trim().replace(/^['"]|['"]$/g, "").trim();

export async function GET(req: NextRequest): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403);
  }

  const url = process.env.DATABASE_URL ?? "";
  const projeto = process.env.NEON_PROJECT_ID ?? "";
  let host: string | null = null;
  try { host = new URL(semAspas(url)).hostname; } catch { host = null; }

  let banco: { timeline: string | null; endpoint: string | null; nome: string | null } | null = null;
  let erro: string | null = null;
  const client = new Client({ connectionString: semAspas(url), connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const r = await client.query(
      "select current_setting('neon.timeline_id', true) as t, current_setting('neon.endpoint_id', true) as e, current_database() as d",
    );
    const linha = r.rows[0] as { t: string | null; e: string | null; d: string | null };
    banco = { timeline: prefixo(linha.t), endpoint: prefixo(linha.e), nome: prefixo(linha.d) };
  } catch (e) {
    erro = e instanceof Error ? e.message.slice(0, 80) : "falha";
  } finally {
    await client.end().catch(() => undefined);
  }

  return ok({
    databaseUrlHash: prefixo(url),
    databaseUrlHashSemAspas: prefixo(semAspas(url)),
    hostHash: prefixo(host),
    projectIdHash: prefixo(projeto),
    projectIdHashSemAspas: prefixo(semAspas(projeto)),
    banco,
    erro,
  });
}
