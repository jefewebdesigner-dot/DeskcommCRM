import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { readConnection } from "./config";
import { fetchBillingRaw } from "./fetch";
import type { OtherExport, StripeExport } from "./contracts";

/**
 * Sincroniza a fonte de billing conectada (Stripe + PIX/manual) com o CRM:
 * cria/atualiza um contato e um negócio (`crm_leads`) por cliente pagante, na
 * etapa de fechamento (won) ou de perda (lost) do funil padrão da organização.
 *
 * Cobertura desigual entre as duas fontes, e isso fica GRAVADO no registro:
 * a v2 (PIX/manual) devolve o cadastro completo de clientes, então
 * `cobertura: "completa"`. A v1 (Stripe) não tem endpoint de lista de
 * clientes — só agregados e três amostras (renovações, pagamentos recentes,
 * atrasados). Sincronizar essas amostras como se fossem o total inventaria
 * uma lista que a fonte não fornece; por isso entram com
 * `cobertura: "amostra_parcial"` e `source` próprio, nunca misturado com a v2.
 */

type Admin = ReturnType<typeof createAdminClient>;

export interface SyncResult {
  configured: boolean;
  contactsCreated: number;
  contactsUpdated: number;
  dealsCreated: number;
  dealsUpdated: number;
  errors: number;
  /** DIAGNÓSTICO TEMPORÁRIO — remover depois de identificar a causa dos erros. */
  sampleErrors: string[];
}

interface PipelineContext {
  pipelineId: string;
  wonStageId: string;
  lostStageId: string;
}

async function resolvePipelineContext(
  admin: Admin,
  organizationId: string,
): Promise<PipelineContext | null> {
  const { data: pipeline } = await admin
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("is_default", true)
    .eq("is_archived", false)
    .maybeSingle();
  if (!pipeline) return null;
  const pipelineId = (pipeline as { id: string }).id;

  const { data: stages } = await admin
    .from("crm_stages")
    .select("id, is_won, is_lost")
    .eq("organization_id", organizationId)
    .eq("pipeline_id", pipelineId)
    .eq("is_archived", false);
  const won = (stages ?? []).find((s) => (s as { is_won: boolean }).is_won);
  const lost = (stages ?? []).find((s) => (s as { is_lost: boolean }).is_lost);
  if (!won || !lost) return null;
  return {
    pipelineId,
    wonStageId: (won as { id: string }).id,
    lostStageId: (lost as { id: string }).id,
  };
}

async function upsertContact(
  admin: Admin,
  organizationId: string,
  input: { email: string; name: string | null; phone: string | null; metadata: Record<string, unknown> },
): Promise<{ id: string; created: boolean } | null> {
  const email = input.email.trim();
  if (!email) return null;
  const emailNorm = email.toLowerCase();

  const findExisting = () =>
    admin
      .from("contacts")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("email_normalized", emailNorm)
      .is("is_merged_into", null)
      .maybeSingle();

  const { data: existing } = await findExisting();
  if (existing) {
    const id = (existing as { id: string }).id;
    await admin
      .from("contacts")
      .update({
        name: input.name ?? undefined,
        phone_number: input.phone ?? undefined,
        source_metadata: input.metadata,
        last_activity_at: new Date().toISOString(),
      })
      .eq("id", id);
    return { id, created: false };
  }

  const { data: created, error } = await admin
    .from("contacts")
    .insert({
      organization_id: organizationId,
      name: input.name ?? email,
      email,
      phone_number: input.phone,
      source: "periciaia_billing",
      source_metadata: input.metadata,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      const { data: retry } = await findExisting();
      if (retry) return { id: (retry as { id: string }).id, created: false };
    }
    throw new Error(error.message);
  }
  return { id: (created as { id: string }).id, created: true };
}

async function upsertDeal(
  admin: Admin,
  organizationId: string,
  ctx: PipelineContext,
  input: {
    contactId: string;
    title: string;
    source: string;
    externalId: string;
    won: boolean;
    valueCents: number | null;
    currency: string | null;
    customFields: Record<string, unknown>;
    closedAt: string;
    lostReason: string | null;
  },
): Promise<{ created: boolean }> {
  const { data: existing } = await admin
    .from("crm_leads")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("source", input.source)
    .eq("external_id", input.externalId)
    .maybeSingle();

  const payload = {
    organization_id: organizationId,
    pipeline_id: ctx.pipelineId,
    stage_id: input.won ? ctx.wonStageId : ctx.lostStageId,
    contact_id: input.contactId,
    title: input.title,
    status: input.won ? "won" : "lost",
    lost_reason: input.won ? null : input.lostReason,
    value_cents: input.valueCents,
    currency: input.currency,
    source: input.source,
    external_id: input.externalId,
    custom_fields: input.customFields,
    closed_at: input.closedAt,
  };

  if (existing) {
    const id = (existing as { id: string }).id;
    await admin.from("crm_leads").update(payload).eq("id", id);
    return { created: false };
  }

  const { error } = await admin.from("crm_leads").insert({
    ...payload,
    position_in_stage: Date.now(),
  });
  if (error && error.code !== "23505") throw new Error(error.message);
  return { created: !error };
}

function syncOther(
  admin: Admin,
  organizationId: string,
  ctx: PipelineContext,
  data: OtherExport,
  result: SyncResult,
): Promise<unknown>[] {
  const byExternalId = new Map(data.customers.map((c) => [`${c.provider}:${c.externalId}`, c]));
  return data.subscriptions.map(async (sub) => {
    const customer = byExternalId.get(`${sub.provider}:${sub.customerExternalId}`);
    if (!customer?.email) return;
    try {
      const contact = await upsertContact(admin, organizationId, {
        email: customer.email,
        name: customer.name ?? null,
        phone: customer.phone ?? null,
        metadata: { periciaia_billing: { provider: customer.provider, external_id: customer.externalId } },
      });
      if (!contact) return;
      if (contact.created) result.contactsCreated++;
      else result.contactsUpdated++;

      const won = sub.status !== "canceled";
      const deal = await upsertDeal(admin, organizationId, ctx, {
        contactId: contact.id,
        title: `PeríciaIA — ${customer.name ?? customer.email}`,
        source: "periciaia_billing",
        externalId: `${sub.provider}:${sub.externalId}`,
        won,
        valueCents: sub.mrrMinor,
        currency: sub.currency.toUpperCase(),
        customFields: {
          cobertura: "completa",
          provedor: sub.provider,
          status_assinatura: sub.status,
          status_pagamento: sub.status === "past_due" ? "atrasado" : won ? "ativo" : "cancelado",
          intervalo: `${sub.intervalCount}x ${sub.billingInterval}`,
          renova_em: sub.currentPeriodEnd,
        },
        closedAt: new Date().toISOString(),
        lostReason: won ? null : "Assinatura cancelada",
      });
      if (deal.created) result.dealsCreated++;
      else result.dealsUpdated++;
    } catch (e) {
      result.errors++;
      if (result.sampleErrors.length < 5) result.sampleErrors.push(e instanceof Error ? e.message : String(e));
    }
  });
}

function syncStripeSample(
  admin: Admin,
  organizationId: string,
  ctx: PipelineContext,
  data: StripeExport,
  result: SyncResult,
): Promise<unknown>[] {
  type Item = { email: string | null | undefined; name: string | null | undefined; note: string };
  const items: Item[] = [
    ...data.recentPayments.map((p) => ({ email: p.email, name: p.name, note: "pagamento_recente" })),
    ...data.upcomingRenewals.map((r) => ({
      email: r.email,
      name: r.name,
      note: r.cancelAtPeriodEnd ? "cancelamento_agendado" : "renovacao_proxima",
    })),
    ...data.pastDueCustomers.map((c) => ({ email: c.email, name: c.name, note: "atrasado" })),
  ];
  return items
    .filter((i): i is Item & { email: string } => !!i.email)
    .map(async (item) => {
      try {
        const contact = await upsertContact(admin, organizationId, {
          email: item.email,
          name: item.name ?? null,
          phone: null,
          metadata: { periciaia_billing: { provider: "stripe", amostra: item.note } },
        });
        if (!contact) return;
        if (contact.created) result.contactsCreated++;
        else result.contactsUpdated++;

        const deal = await upsertDeal(admin, organizationId, ctx, {
          contactId: contact.id,
          title: `PeríciaIA — ${item.name ?? item.email}`,
          source: "periciaia_billing_stripe_amostra",
          externalId: item.email,
          won: true,
          valueCents: null,
          currency: null,
          customFields: {
            cobertura: "amostra_parcial",
            provedor: "stripe",
            status_pagamento: item.note === "atrasado" ? "atrasado" : "ativo",
            observacao: item.note,
          },
          closedAt: new Date().toISOString(),
          lostReason: null,
        });
        if (deal.created) result.dealsCreated++;
        else result.dealsUpdated++;
      } catch (e) {
        result.errors++;
        if (result.sampleErrors.length < 5) result.sampleErrors.push(e instanceof Error ? e.message : String(e));
      }
    });
}

export async function syncBillingToCrm(organizationId: string): Promise<SyncResult> {
  const result: SyncResult = {
    configured: false,
    contactsCreated: 0,
    contactsUpdated: 0,
    dealsCreated: 0,
    dealsUpdated: 0,
    errors: 0,
    sampleErrors: [],
  };

  const connection = await readConnection(organizationId);
  if (!connection) return result;
  result.configured = true;

  const admin = createAdminClient();
  const ctx = await resolvePipelineContext(admin, organizationId);
  if (!ctx) return result;

  const { stripe, other } = await fetchBillingRaw(connection.token);

  const tasks: Promise<unknown>[] = [];
  if (other.ok) tasks.push(...syncOther(admin, organizationId, ctx, other.data as OtherExport, result));
  if (stripe.ok) tasks.push(...syncStripeSample(admin, organizationId, ctx, stripe.data as StripeExport, result));
  await Promise.all(tasks);

  return result;
}
