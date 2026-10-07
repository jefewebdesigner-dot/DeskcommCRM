import "server-only";

import { statusTokenPje } from "@/lib/pje/config";
import { estadoPontePje } from "@/lib/pje/legacy-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  PERICIAIA_ORGANIZATION_ID,
  periciaiaIdentities,
} from "@/lib/vertical-packs/periciaia-customer360";

type ContactRow = {
  id: string;
  custom_fields: Record<string, unknown> | null;
};

type FinancialSubscription = {
  provider?: unknown;
  subscriptionId?: unknown;
  customerId?: unknown;
};

export type CutoverCheck = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  blocking: boolean;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function source(provider: unknown) {
  const value = text(provider)?.toLowerCase() ?? "";
  return value
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

function subscriptionsOf(contact: ContactRow) {
  const financeiro = (contact.custom_fields?.financeiro ?? {}) as {
    assinaturas?: unknown;
  };
  return Array.isArray(financeiro.assinaturas)
    ? (financeiro.assinaturas as FinancialSubscription[])
    : [];
}

async function loadContacts() {
  const admin = createAdminClient();
  const rows: ContactRow[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const result = await admin
      .from("contacts")
      .select("id,custom_fields")
      .eq("organization_id", PERICIAIA_ORGANIZATION_ID)
      .is("is_merged_into", null)
      .range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    const page = (result.data ?? []) as ContactRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

export function evaluatePericiaiaCutover(input: {
  packStatus: string | null;
  eligibleContacts: number;
  missingAccounts: number;
  expectedIdentities: number;
  missingIdentities: number;
  expectedSubscriptions: number;
  missingRevenueStates: number;
  pjeConfigured: boolean;
  legacyBridgeConfigured: boolean;
}) {
  const checks: CutoverCheck[] = [
    {
      id: "pack",
      label: "Vertical Pack da PeríciaIA",
      ok: input.packStatus === "transitioning" || input.packStatus === "active",
      detail: input.packStatus
        ? `Pack registrado como ${input.packStatus}.`
        : "Pack ainda não registrado no banco.",
      blocking: true,
    },
    {
      id: "customer360",
      label: "Clientes no Customer 360",
      ok: input.eligibleContacts > 0 && input.missingAccounts === 0,
      detail:
        input.missingAccounts === 0
          ? `${input.eligibleContacts} contato(s) financeiro(s) vinculados sem duplicação.`
          : `${input.missingAccounts} contato(s) financeiro(s) ainda sem conta SaaS.`,
      blocking: true,
    },
    {
      id: "identities",
      label: "Identidades financeiras",
      ok: input.expectedIdentities > 0 && input.missingIdentities === 0,
      detail:
        input.missingIdentities === 0
          ? `${input.expectedIdentities} identidade(s) reconciliadas.`
          : `${input.missingIdentities} identidade(s) de billing ainda sem vínculo.`,
      blocking: true,
    },
    {
      id: "revenue",
      label: "Assinaturas no Revenue OS",
      ok: input.expectedSubscriptions > 0 && input.missingRevenueStates === 0,
      detail:
        input.missingRevenueStates === 0
          ? `${input.expectedSubscriptions} assinatura(s) encontradas no ledger atual.`
          : `${input.missingRevenueStates} assinatura(s) ainda não chegaram ao Revenue OS.`,
      blocking: true,
    },
    {
      id: "pje",
      label: "PJe preservado",
      ok: input.pjeConfigured,
      detail: input.pjeConfigured
        ? "Token Ouro continua configurado no novo core."
        : "Token Ouro ainda não está configurado no novo core.",
      blocking: true,
    },
    {
      id: "legacy_bridge",
      label: "Ponte temporária do backend atual",
      ok: input.legacyBridgeConfigured,
      detail: input.legacyBridgeConfigured
        ? "Ponte legada disponível durante a convivência."
        : "Ponte legada não configurada; validar antes do cutover operacional.",
      blocking: input.packStatus !== "active",
    },
  ];

  return {
    checks,
    blockingReady: checks.filter((check) => check.blocking).every((check) => check.ok),
    progress:
      checks.length === 0
        ? 0
        : Math.round((checks.filter((check) => check.ok).length / checks.length) * 100),
  };
}

export async function loadPericiaiaCutoverStatus() {
  const admin = createAdminClient();
  const contacts = await loadContacts();

  const eligible = contacts.filter((contact) =>
    periciaiaIdentities(contact).some((identity) => identity.source !== "periciaia"),
  );

  const expectedIdentityKeys = new Set<string>();
  const expectedSubscriptionKeys = new Set<string>();

  for (const contact of eligible) {
    for (const identity of periciaiaIdentities(contact)) {
      if (identity.source === "periciaia") continue;
      expectedIdentityKeys.add(
        identity.source + "|" + identity.externalCustomerId,
      );
    }
    for (const subscription of subscriptionsOf(contact)) {
      const provider = source(subscription.provider);
      const subscriptionId = text(subscription.subscriptionId);
      if (!provider || !subscriptionId) continue;
      expectedSubscriptionKeys.add(provider + "|" + subscriptionId);
    }
  }

  const [pack, accounts, identities, revenueStates, pje, bridge] =
    await Promise.all([
      admin
        .from("organization_vertical_packs")
        .select("status")
        .eq("organization_id", PERICIAIA_ORGANIZATION_ID)
        .eq("pack_id", "periciaia")
        .maybeSingle(),
      admin
        .from("saas_accounts")
        .select("id,contact_id")
        .eq("organization_id", PERICIAIA_ORGANIZATION_ID),
      admin
        .from("saas_account_identities")
        .select("source,external_customer_id")
        .eq("organization_id", PERICIAIA_ORGANIZATION_ID),
      admin
        .from("revenue_subscription_states")
        .select("source,external_subscription_id")
        .eq("organization_id", PERICIAIA_ORGANIZATION_ID),
      statusTokenPje(),
      estadoPontePje(),
    ]);

  if (pack.error) throw pack.error;
  if (accounts.error) throw accounts.error;
  if (identities.error) throw identities.error;
  if (revenueStates.error) throw revenueStates.error;

  const accountContacts = new Set(
    (accounts.data ?? [])
      .map((row) => (row.contact_id ? String(row.contact_id) : null))
      .filter((value): value is string => Boolean(value)),
  );
  const actualIdentities = new Set(
    (identities.data ?? []).map(
      (row) => String(row.source) + "|" + String(row.external_customer_id),
    ),
  );
  const actualSubscriptions = new Set(
    (revenueStates.data ?? []).map(
      (row) => String(row.source) + "|" + String(row.external_subscription_id),
    ),
  );

  const missingAccounts = eligible.filter(
    (contact) => !accountContacts.has(contact.id),
  ).length;
  const missingIdentities = [...expectedIdentityKeys].filter(
    (key) => !actualIdentities.has(key),
  ).length;
  const missingRevenueStates = [...expectedSubscriptionKeys].filter(
    (key) => !actualSubscriptions.has(key),
  ).length;

  const evaluation = evaluatePericiaiaCutover({
    packStatus: pack.data?.status ? String(pack.data.status) : null,
    eligibleContacts: eligible.length,
    missingAccounts,
    expectedIdentities: expectedIdentityKeys.size,
    missingIdentities,
    expectedSubscriptions: expectedSubscriptionKeys.size,
    missingRevenueStates,
    pjeConfigured: pje.configurado,
    legacyBridgeConfigured: bridge.configurada,
  });

  return {
    organizationId: PERICIAIA_ORGANIZATION_ID,
    packStatus: pack.data?.status ? String(pack.data.status) : null,
    totals: {
      contacts: contacts.length,
      eligibleContacts: eligible.length,
      saasAccounts: (accounts.data ?? []).length,
      expectedIdentities: expectedIdentityKeys.size,
      actualIdentities: actualIdentities.size,
      expectedSubscriptions: expectedSubscriptionKeys.size,
      actualRevenueStates: actualSubscriptions.size,
      missingAccounts,
      missingIdentities,
      missingRevenueStates,
    },
    pje,
    bridge,
    ...evaluation,
  };
}
