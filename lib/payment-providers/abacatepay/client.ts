import "server-only";

import { z } from "zod";

/**
 * Cliente fino da API real da AbacatePay (`https://api.abacatepay.com/v2`).
 *
 * ⚠️ Só `/v2/*`. A conta desta instalação dá `"API key version mismatch"` em
 * QUALQUER `/v1/*` — medido direto contra a API, não documentado. `/v2` é o
 * que a doc oficial descreve hoje (stores, customers, checkouts).
 *
 * Erros nunca carregam a chave nem o corpo cru da resposta — só a shape que
 * `AbacatePayError` expõe.
 */
const BASE = "https://api.abacatepay.com/v2";
const TIMEOUT_MS = 15_000;

export class AbacatePayError extends Error {
  constructor(
    public readonly kind: "unauthorized" | "unavailable" | "invalid_data",
    message: string,
  ) {
    super(message);
    this.name = "AbacatePayError";
  }
}

const envelopeSchema = z.object({
  success: z.boolean(),
  data: z.unknown(),
  error: z.string().nullable().optional(),
  pagination: z
    .object({ hasMore: z.boolean(), next: z.string().nullable() })
    .partial()
    .optional(),
});

async function request<T>(
  apiKey: string,
  path: string,
  schema: z.ZodType<T>,
): Promise<{ data: T; next: string | null }> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AbacatePayError("unavailable", "AbacatePay indisponível agora.");
  }
  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch {
    throw new AbacatePayError("invalid_data", "Resposta inesperada da AbacatePay.");
  }
  const parsed = envelopeSchema.safeParse(envelope);
  if (!parsed.success) throw new AbacatePayError("invalid_data", "Resposta inesperada da AbacatePay.");
  if (!parsed.data.success) {
    const msg = parsed.data.error ?? "";
    const isAuth =
      response.status === 401 ||
      response.status === 403 ||
      /unauthorized|version mismatch/i.test(msg);
    throw new AbacatePayError(
      isAuth ? "unauthorized" : "unavailable",
      isAuth ? "Chave da AbacatePay inválida ou sem permissão." : "AbacatePay recusou a consulta.",
    );
  }
  const data = schema.safeParse(parsed.data.data);
  if (!data.success) throw new AbacatePayError("invalid_data", "Dados da AbacatePay em formato inesperado.");
  return { data: data.data, next: parsed.data.pagination?.hasMore ? (parsed.data.pagination?.next ?? null) : null };
}

const storeSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  balance: z
    .object({
      available: z.number(),
      pending: z.number(),
      blocked: z.number(),
    })
    .partial()
    .optional(),
});

export const customerSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  taxId: z.string().nullable().optional(),
  cellphone: z.string().nullable().optional(),
});
export type AbacatePayCustomer = z.infer<typeof customerSchema>;

export const checkoutSchema = z.object({
  id: z.string(),
  externalId: z.string().nullable().optional(),
  amount: z.number(),
  paidAmount: z.number().nullable().optional(),
  status: z.enum(["PENDING", "EXPIRED", "CANCELLED", "PAID", "REFUNDED"]),
  frequency: z.string().nullable().optional(),
  customerId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  nextChargeAt: z.string().nullable().optional(),
});
export type AbacatePayCheckout = z.infer<typeof checkoutSchema>;

const TETO_DE_PAGINAS = 500;

/** `/v2/stores/get` — valida a chave e identifica a loja conectada. */
export async function fetchStore(apiKey: string): Promise<{ id: string; name: string | null }> {
  const { data } = await request(apiKey, "/stores/get", storeSchema);
  return { id: data.id, name: data.name };
}

/** Até 50k clientes — mesmo teto do contrato `OtherExport` já usado para Stripe/manual. */
export async function listCustomers(apiKey: string): Promise<AbacatePayCustomer[]> {
  const todos: AbacatePayCustomer[] = [];
  let after: string | null = null;
  for (let pagina = 0; pagina < TETO_DE_PAGINAS; pagina++) {
    const qs = new URLSearchParams({ limit: "100" });
    if (after) qs.set("after", after);
    const { data, next } = await request(
      apiKey,
      `/customers/list?${qs.toString()}`,
      z.array(customerSchema).max(100),
    );
    todos.push(...data);
    if (!next) break;
    after = next;
  }
  return todos;
}

/** Até 50k checkouts (cada um é um evento de cobrança — PIX/cartão, recorrente ou avulso). */
export async function listCheckouts(apiKey: string): Promise<AbacatePayCheckout[]> {
  const todos: AbacatePayCheckout[] = [];
  let after: string | null = null;
  for (let pagina = 0; pagina < TETO_DE_PAGINAS; pagina++) {
    const qs = new URLSearchParams({ limit: "100" });
    if (after) qs.set("after", after);
    const { data, next } = await request(
      apiKey,
      `/checkouts/list?${qs.toString()}`,
      z.array(checkoutSchema).max(100),
    );
    todos.push(...data);
    if (!next) break;
    after = next;
  }
  return todos;
}
