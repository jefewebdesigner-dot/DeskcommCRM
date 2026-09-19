import { z } from "zod";

const texto = (min: number, max: number) => z.string().trim().min(min).max(max);
const textoOpcional = (max: number) => z.string().trim().max(max).optional().default("");

const leadFieldSchema = z
  .object({
    key: texto(1, 50).regex(/^[a-z][a-z0-9_]*$/i),
    label: texto(1, 80),
    type: z.enum([
      "text",
      "textarea",
      "number",
      "date",
      "select",
      "multiselect",
      "boolean",
      "email",
      "phone",
      "url",
    ]),
    required: z.boolean().optional().default(false),
    options: z
      .array(z.object({ value: texto(1, 80), label: texto(1, 80) }).strict())
      .max(40)
      .optional(),
  })
  .strict();

const automationPlanSchema = z
  .object({
    name: texto(1, 120),
    trigger: texto(1, 100),
    delay_minutes: z
      .number()
      .int()
      .min(0)
      .max(60 * 24 * 365)
      .default(0),
    action: texto(1, 120),
    goal: textoOpcional(240),
  })
  .strict();

export const salesTwinBlueprintSchema = z
  .object({
    sales_twin_version: z.literal(1),
    deployment_id: texto(1, 120),
    organization: z
      .object({
        name: texto(1, 140),
        segment: textoOpcional(120),
        summary: textoOpcional(1200),
        audience: z.array(texto(1, 180)).max(20).default([]),
        location: textoOpcional(180),
      })
      .strict(),
    offer: z
      .object({
        primary: textoOpcional(300),
        services: z.array(texto(1, 180)).max(40).default([]),
        conversion_goal: textoOpcional(300),
      })
      .strict(),
    pipeline: z
      .object({
        pipeline_name: texto(1, 100),
        stages: z.array(texto(1, 80)).min(3).max(12),
        lead_fields: z.array(leadFieldSchema).max(30).default([]),
        tags: z.array(texto(1, 60)).max(30).default([]),
        vocabulary: z
          .object({
            lead: texto(1, 40).optional(),
            deal: texto(1, 40).optional(),
            won: texto(1, 40).optional(),
            lost: texto(1, 40).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    agent: z
      .object({
        name: texto(1, 120),
        objective: texto(1, 1200),
        tone: textoOpcional(240),
        qualification_questions: z.array(texto(1, 300)).max(20).default([]),
        handoff_rules: z.array(texto(1, 300)).max(20).default([]),
        forbidden_claims: z.array(texto(1, 300)).max(20).default([]),
      })
      .strict(),
    automations: z.array(automationPlanSchema).max(40).default([]),
    tracking: z
      .object({
        events: z.array(texto(1, 80)).max(40).default([]),
        utm_required: z.boolean().default(true),
      })
      .strict(),
    knowledge: z
      .object({
        known_facts: z.array(texto(1, 300)).max(50).default([]),
        required_sources: z.array(texto(1, 240)).max(40).default([]),
        missing_facts: z.array(texto(1, 300)).max(50).default([]),
      })
      .strict(),
    generated_at: z.string().datetime().nullable().optional(),
  })
  .strict();

export type SalesTwinBlueprint = z.infer<typeof salesTwinBlueprintSchema>;
