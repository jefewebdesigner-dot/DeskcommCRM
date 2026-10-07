import { z } from "zod";

const source = z.string().regex(/^[a-z][a-z0-9_-]{1,49}$/);
const externalId = z.string().trim().min(1).max(200);

const safeProperties = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .default({})
  .superRefine((value, ctx) => {
    const forbidden = /(email|phone|telefone|cpf|cnpj|document|address|endereco|name|nome)/i;
    for (const key of Object.keys(value)) {
      if (forbidden.test(key)) ctx.addIssue({ code: "custom", message: "Propriedade pessoal não é aceita em telemetria.", path: [key] });
    }
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > 16 * 1024) {
      ctx.addIssue({ code: "custom", message: "properties excede 16 KB." });
    }
  });

export const productEventsRequestSchema = z.object({
  events: z.array(z.object({
    external_event_id: externalId,
    source,
    external_customer_id: externalId,
    event_name: z.string().regex(/^[a-z][a-z0-9_]{1,99}$/),
    occurred_at: z.iso.datetime({ offset: true }),
    properties: safeProperties.optional(),
  })).min(1).max(100),
});

export const revenueObservationSchema = z.object({
  external_event_id: externalId,
  source,
  external_subscription_id: externalId,
  external_customer_id: externalId,
  customer_name: z.string().trim().max(200).optional(),
  status: z.enum(["active","past_due","canceling","canceled","unknown"]),
  mrr_cents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  started_at: z.iso.datetime({ offset: true }).optional(),
  ended_at: z.iso.datetime({ offset: true }).optional(),
  observed_at: z.iso.datetime({ offset: true }),
  // Use true only when importing an already-existing customer base.
  // Baseline updates current MRR without creating fake "new MRR" events.
  baseline: z.boolean().optional(),
});
