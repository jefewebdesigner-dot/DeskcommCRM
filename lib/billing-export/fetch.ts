import "server-only";
import type { z } from "zod";
import {
  stripeExportSchema,
  otherExportSchema,
  normalizeStripe,
  normalizeOther,
  type BillingDashboard,
  type SourceResult,
} from "./contracts";

const BASE = "https://www.periciaia.com.br/api/admin/billing-export";
const MAX_BYTES = 10 * 1024 * 1024;

/** URL fixa; nunca segue redirects com o bearer. Erros não incluem body/header. */
async function readSource<T>(
  token: string,
  path: "" | "/v2",
  schema: z.ZodType<T>,
): Promise<SourceResult<T>> {
  try {
    const response = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return {
        ok: false,
        error: response.status === 401 || response.status === 403 ? "unauthorized" : "unavailable",
      };
    }
    if (!response.body) return { ok: false, error: "invalid_data" };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return { ok: false, error: "invalid_data" };
      }
      chunks.push(value);
    }
    const parsed = schema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: "invalid_data" };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/**
 * As duas fontes CRUAS, sem a normalização para exibição. `fetchBillingDashboard`
 * é a projeção disto para a tela; quem precisa dos campos crus (o sync com o
 * CRM precisa de email/telefone por assinatura, que a normalização descarta)
 * chama esta função em vez de duplicar `readSource`.
 */
export async function fetchBillingRaw(token: string): Promise<{
  stripe: SourceResult<z.infer<typeof stripeExportSchema>>;
  other: SourceResult<z.infer<typeof otherExportSchema>>;
}> {
  const [stripe, other] = await Promise.all([
    readSource(token, "", stripeExportSchema),
    readSource(token, "/v2", otherExportSchema),
  ]);
  return { stripe, other };
}

export async function fetchBillingDashboard(token: string): Promise<BillingDashboard> {
  const { stripe, other } = await fetchBillingRaw(token);
  return {
    fetched_at: new Date().toISOString(),
    stripe: stripe.ok ? { ok: true, data: normalizeStripe(stripe.data) } : stripe,
    other: other.ok ? { ok: true, data: normalizeOther(other.data) } : other,
  };
}
