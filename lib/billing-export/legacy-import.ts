import "server-only";

import { createHash } from "node:crypto";

import { readConnection } from "./config";
import { fetchBillingRaw } from "./fetch";
import {
  fetchStripeLifecycleSnapshot,
  type StripeLifecycleRow,
} from "./stripe-direct";
import {
  fetchLegacyCrmExport,
  type LegacyLead,
  type LegacyUser,
} from "./legacy-crm";
import type { OtherExport } from "./contracts";

export type LegacyImportBucket = "active" | "past_due" | "canceled" | "lead";

type EvidenceKind =
  | "legacy_user"
  | "legacy_lead"
  | "billing_active"
  | "billing_past_due"
  | "billing_canceled";

export interface Evidence {
  kind: EvidenceKind;
  sourceId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  keys: string[];
  legacyUser?: LegacyUser;
  legacyLead?: LegacyLead;
  cancelAtPeriodEnd?: boolean;
  provider?: string | null;
  subscriptionId?: string | null;
  customerId?: string | null;
}

export interface LegacyImportSubscription {
  provider: string;
  subscriptionId: string;
  customerId: string | null;
  status: "active" | "past_due" | "canceled";
  cancelAtPeriodEnd: boolean;
}

export interface LegacyImportEntity {
  id: string;
  bucket: LegacyImportBucket;
  name: string | null;
  email: string | null;
  phone: string | null;
  cancelAtPeriodEnd: boolean;
  legacyUserIds: string[];
  legacyLeadIds: string[];
  legacyStages: string[];
  legacyFunnels: string[];
  legacyPlanStatuses: string[];
  paymentProviders: string[];
  paymentCustomerIds: string[];
  paymentSubscriptionIds: string[];
  /**
   * Cada assinatura com o STATUS dela. `paymentSubscriptionIds` mistura ativas e
   * canceladas da mesma pessoa e não permite provar "43 assinaturas ativas para
   * 42 pessoas"; esta lista permite, e é o que vai para os metadados financeiros
   * do contato. Assinatura não é pessoa: uma pessoa pode ter várias.
   */
  subscriptions: LegacyImportSubscription[];
  sourceRecordCount: number;
  identityKeys: string[];
}

export interface LegacyImportPlan {
  generatedAt: string;
  entities: LegacyImportEntity[];
  summary: {
    legacySourceRows: number;
    uniquePeople: number;
    active: number;
    pastDue: number;
    canceled: number;
    leadsForFirstContact: number;
    cancelRequestedAmongActive: number;
    currentBillingActiveEvidence: number;
    currentBillingPastDueEvidence: number;
    currentBillingCanceledEvidence: number;
    activeEntitiesWithMultipleSubscriptions: number;
    activeEntitiesWithMultipleProviders: number;
    groupsWithoutEmailOrPhone: number;
    duplicateRowsCollapsed: number;
  };
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function emailOf(value: unknown): string | null {
  return nonEmpty(value)?.toLowerCase() ?? null;
}

export function phoneE164(value: unknown): string | null {
  const raw = nonEmpty(value);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((v) => nonEmpty(v)).filter((v): v is string => Boolean(v)))];
}

function identityKeys(input: {
  email?: string | null;
  phone?: string | null;
  firebaseUserId?: string | null;
  convertedUserId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  abacateCustomerId?: string | null;
  abacateSubscriptionId?: string | null;
  provider?: string | null;
  customerId?: string | null;
  subscriptionId?: string | null;
}): string[] {
  const keys: string[] = [];
  const email = emailOf(input.email);
  const phone = phoneE164(input.phone);
  if (email) keys.push(`email:${email}`);
  if (phone) keys.push(`phone:${phone}`);
  if (input.firebaseUserId) keys.push(`firebase_user:${input.firebaseUserId}`);
  if (input.convertedUserId) keys.push(`firebase_user:${input.convertedUserId}`);
  if (input.stripeCustomerId) keys.push(`customer:stripe:${input.stripeCustomerId}`);
  if (input.stripeSubscriptionId) keys.push(`subscription:stripe:${input.stripeSubscriptionId}`);
  if (input.abacateCustomerId) keys.push(`customer:abacatepay:${input.abacateCustomerId}`);
  if (input.abacateSubscriptionId) {
    keys.push(`subscription:abacatepay:${input.abacateSubscriptionId}`);
  }
  if (input.provider && input.customerId) {
    keys.push(`customer:${input.provider}:${input.customerId}`);
  }
  if (input.provider && input.subscriptionId) {
    keys.push(`subscription:${input.provider}:${input.subscriptionId}`);
  }
  return unique(keys);
}

class Dsu {
  private parent: number[] = [];
  private rank: number[] = [];

  add(): number {
    const n = this.parent.length;
    this.parent.push(n);
    this.rank.push(0);
    return n;
  }

  find(x: number): number {
    const parent = this.parent[x]!;
    if (parent !== x) this.parent[x] = this.find(parent);
    return this.parent[x]!;
  }

  union(a: number, b: number): number {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return ra;
    const rankA = this.rank[ra]!;
    const rankB = this.rank[rb]!;
    if (rankA < rankB) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    if (rankA === rankB) this.rank[ra] = rankA + 1;
    return ra;
  }
}

function evidenceFromLegacyUser(user: LegacyUser): Evidence {
  const uid = nonEmpty(user.uid) ?? createHash("sha256").update(JSON.stringify(user)).digest("hex");
  return {
    kind: "legacy_user",
    sourceId: uid,
    name: nonEmpty(user.displayName),
    email: emailOf(user.email),
    phone: phoneE164(user.phone),
    keys: identityKeys({
      email: user.email,
      phone: user.phone,
      firebaseUserId: user.uid,
      stripeCustomerId: user.stripeCustomerId,
      stripeSubscriptionId: user.stripeSubscriptionId,
      abacateCustomerId: user.abacatepayCustomerId,
      abacateSubscriptionId: user.abacatepaySubscriptionId,
    }),
    legacyUser: user,
    provider: nonEmpty(user.paymentProvider),
  };
}

function evidenceFromLegacyLead(lead: LegacyLead): Evidence {
  const uid = nonEmpty(lead.uid) ?? createHash("sha256").update(JSON.stringify(lead)).digest("hex");
  return {
    kind: "legacy_lead",
    sourceId: uid,
    name: nonEmpty(lead.displayName),
    email: emailOf(lead.email),
    phone: phoneE164(lead.phone),
    keys: identityKeys({
      email: lead.email,
      phone: lead.phone,
      convertedUserId: lead.convertidoUid,
    }),
    legacyLead: lead,
  };
}

function currentKind(status: string): EvidenceKind {
  if (status === "active") return "billing_active";
  if (status === "past_due") return "billing_past_due";
  return "billing_canceled";
}

function evidencesFromOther(data: OtherExport): Evidence[] {
  const customerKey = (provider: string, id: string) => `${provider}:${id}`;
  const customers = new Map(
    data.customers.map((customer) => [customerKey(customer.provider, customer.externalId), customer]),
  );

  return data.subscriptions.map((subscription) => {
    const customer = customers.get(
      customerKey(subscription.provider, subscription.customerExternalId),
    );
    const status =
      subscription.status === "active"
        ? "active"
        : subscription.status === "past_due"
          ? "past_due"
          : "canceled";
    return {
      kind: currentKind(status),
      sourceId: `${subscription.provider}:${subscription.externalId}`,
      name: nonEmpty(customer?.name),
      email: emailOf(customer?.email),
      phone: phoneE164(customer?.phone),
      keys: identityKeys({
        email: customer?.email,
        phone: customer?.phone,
        provider: subscription.provider,
        customerId: subscription.customerExternalId,
        subscriptionId: subscription.externalId,
      }),
      provider: subscription.provider,
      subscriptionId: subscription.externalId,
      customerId: subscription.customerExternalId,
      cancelAtPeriodEnd: false,
    } satisfies Evidence;
  });
}

function evidenceFromStripe(row: StripeLifecycleRow): Evidence {
  return {
    kind: currentKind(row.status),
    sourceId: `stripe:${row.subscriptionId}`,
    name: nonEmpty(row.name),
    email: emailOf(row.email),
    phone: null,
    keys: identityKeys({
      email: row.email,
      provider: "stripe",
      customerId: row.customerId,
      subscriptionId: row.subscriptionId,
    }),
    provider: "stripe",
    subscriptionId: row.subscriptionId,
    customerId: row.customerId,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
  };
}

function choose<T>(
  evidences: Evidence[],
  getter: (row: Evidence) => T | null | undefined,
): T | null {
  const priority: EvidenceKind[] = [
    "billing_active",
    "billing_past_due",
    "legacy_user",
    "legacy_lead",
    "billing_canceled",
  ];
  for (const kind of priority) {
    for (const row of evidences) {
      if (row.kind !== kind) continue;
      const value = getter(row);
      if (value !== null && value !== undefined && value !== "") return value;
    }
  }
  return null;
}

function bucketOf(evidences: Evidence[]): LegacyImportBucket {
  if (evidences.some((e) => e.kind === "billing_active")) return "active";
  if (evidences.some((e) => e.kind === "billing_past_due")) return "past_due";
  const legacyCanceled = evidences.some((e) => {
    const status = e.legacyUser?.planStatus?.trim().toLowerCase();
    return status === "canceled" || status === "cancelled";
  });
  if (legacyCanceled || evidences.some((e) => e.kind === "billing_canceled")) return "canceled";
  return "lead";
}

function stableEntityId(evidences: Evidence[], keys: string[]): string {
  const user = evidences
    .filter((e) => e.kind === "legacy_user")
    .map((e) => e.sourceId)
    .sort()[0];
  if (user) return `user:${user}`;
  const lead = evidences
    .filter((e) => e.kind === "legacy_lead")
    .map((e) => e.sourceId)
    .sort()[0];
  if (lead) return `lead:${lead}`;
  const subscription = evidences
    .map((e) => e.subscriptionId)
    .filter((v): v is string => Boolean(v))
    .sort()[0];
  if (subscription) return `billing:${subscription}`;
  return `identity:${createHash("sha256").update(keys.sort().join("|")).digest("hex").slice(0, 32)}`;
}

/** Assinaturas das evidências de billing (sem duplicar provider+id). */
function subscriptionsOf(rows: Evidence[]): LegacyImportSubscription[] {
  const porChave = new Map<string, LegacyImportSubscription>();
  for (const row of rows) {
    if (!row.kind.startsWith("billing_") || !row.subscriptionId) continue;
    const status: LegacyImportSubscription["status"] =
      row.kind === "billing_active" ? "active" : row.kind === "billing_past_due" ? "past_due" : "canceled";
    const provider = row.provider ?? "desconhecido";
    porChave.set(`${provider}:${row.subscriptionId}`, {
      provider,
      subscriptionId: row.subscriptionId,
      customerId: row.customerId ?? null,
      status,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd === true,
    });
  }
  return [...porChave.values()].sort((a, b) =>
    `${a.provider}:${a.subscriptionId}`.localeCompare(`${b.provider}:${b.subscriptionId}`),
  );
}

/**
 * Junta evidências que se referem à mesma pessoa (e-mail, telefone, ids do
 * Firebase, do Stripe e do AbacatePay) e classifica cada pessoa. Compartilhada
 * pela importação histórica e pelo sincronizador contínuo de billing, para que
 * os dois concordem sobre quem é quem.
 */
export function agruparEntidades(evidences: Evidence[]): LegacyImportEntity[] {
  const dsu = new Dsu();
  const keyOwner = new Map<string, number>();

  for (const evidence of evidences) {
    const index = dsu.add();
    for (const key of evidence.keys) {
      const previous = keyOwner.get(key);
      if (previous === undefined) {
        keyOwner.set(key, index);
      } else {
        dsu.union(index, previous);
      }
    }
  }

  // Uma união posterior pode ligar duas chaves que já apontavam para raízes
  // diferentes; agrupar só depois de concluir todas as unions evita grupos
  // artificiais duplicados.
  const groups = new Map<number, Evidence[]>();
  evidences.forEach((evidence, index) => {
    const root = dsu.find(index);
    const rows = groups.get(root) ?? [];
    rows.push(evidence);
    groups.set(root, rows);
  });

  const entities: LegacyImportEntity[] = [...groups.values()].map((rows) => {
    const keys = unique(rows.flatMap((row) => row.keys));
    const bucket = bucketOf(rows);
    const legacyUsers = rows.flatMap((row) => (row.legacyUser ? [row.legacyUser] : []));
    const legacyLeads = rows.flatMap((row) => (row.legacyLead ? [row.legacyLead] : []));
    return {
      id: stableEntityId(rows, keys),
      bucket,
      name: choose(rows, (row) => row.name),
      email: choose(rows, (row) => row.email),
      phone: choose(rows, (row) => row.phone),
      cancelAtPeriodEnd:
        bucket === "active" &&
        rows.some((row) => row.kind === "billing_active" && row.cancelAtPeriodEnd === true),
      legacyUserIds: unique(legacyUsers.map((row) => row.uid)),
      legacyLeadIds: unique(legacyLeads.map((row) => row.uid)),
      legacyStages: unique([
        ...legacyUsers.map((row) => row.crmStage),
        ...legacyLeads.map((row) => row.crmStage),
      ]),
      legacyFunnels: unique(legacyUsers.map((row) => row.funnelType)),
      legacyPlanStatuses: unique(legacyUsers.map((row) => row.planStatus)),
      paymentProviders: unique(rows.map((row) => row.provider)),
      paymentCustomerIds: unique(rows.map((row) => row.customerId)),
      paymentSubscriptionIds: unique(rows.map((row) => row.subscriptionId)),
      subscriptions: subscriptionsOf(rows),
      sourceRecordCount: rows.length,
      identityKeys: keys,
    };
  });

  entities.sort((a, b) => a.id.localeCompare(b.id));
  return entities;
}

export async function buildLegacyImportPlan(organizationId: string): Promise<LegacyImportPlan> {
  const [legacyResult, connection, stripeLifecycle] = await Promise.all([
    fetchLegacyCrmExport(organizationId),
    readConnection(organizationId),
    fetchStripeLifecycleSnapshot(),
  ]);
  if (!legacyResult.configured || !legacyResult.data) {
    throw new Error("CRM legado não configurado.");
  }
  if (!connection) throw new Error("Billing não configurado.");
  if (!stripeLifecycle) throw new Error("Stripe direta não configurada.");

  const billing = await fetchBillingRaw(connection.token);
  if (!billing.other.ok) {
    throw new Error(`Billing v2 indisponível: ${billing.other.error}.`);
  }

  const evidences: Evidence[] = [
    ...(legacyResult.data.users ?? []).map(evidenceFromLegacyUser),
    ...(legacyResult.data.leads ?? []).map(evidenceFromLegacyLead),
    ...evidencesFromOther(billing.other.data as OtherExport),
    ...stripeLifecycle.active.map(evidenceFromStripe),
    ...stripeLifecycle.pastDue.map(evidenceFromStripe),
    ...stripeLifecycle.canceled.map(evidenceFromStripe),
  ];

  const entities = agruparEntidades(evidences);

  const legacySourceRows =
    (legacyResult.data.users?.length ?? 0) + (legacyResult.data.leads?.length ?? 0);
  const currentBillingRows = evidences.filter((row) => row.kind.startsWith("billing_"));
  return {
    generatedAt: new Date().toISOString(),
    entities,
    summary: {
      legacySourceRows,
      uniquePeople: entities.length,
      active: entities.filter((row) => row.bucket === "active").length,
      pastDue: entities.filter((row) => row.bucket === "past_due").length,
      canceled: entities.filter((row) => row.bucket === "canceled").length,
      leadsForFirstContact: entities.filter((row) => row.bucket === "lead").length,
      cancelRequestedAmongActive: entities.filter(
        (row) => row.bucket === "active" && row.cancelAtPeriodEnd,
      ).length,
      currentBillingActiveEvidence: currentBillingRows.filter(
        (row) => row.kind === "billing_active",
      ).length,
      currentBillingPastDueEvidence: currentBillingRows.filter(
        (row) => row.kind === "billing_past_due",
      ).length,
      currentBillingCanceledEvidence: currentBillingRows.filter(
        (row) => row.kind === "billing_canceled",
      ).length,
      activeEntitiesWithMultipleSubscriptions: entities.filter(
        (row) => row.bucket === "active" && row.paymentSubscriptionIds.length > 1,
      ).length,
      activeEntitiesWithMultipleProviders: entities.filter(
        (row) => row.bucket === "active" && row.paymentProviders.length > 1,
      ).length,
      groupsWithoutEmailOrPhone: entities.filter((row) => !row.email && !row.phone).length,
      duplicateRowsCollapsed: Math.max(0, evidences.length - entities.length),
    },
  };
}

/**
 * As pessoas com assinatura, só a partir das fontes VIVAS de billing (v2
 * PIX/manual + Stripe completa), sem o CRM legado. É o que o sincronizador
 * contínuo usa. Fail-closed: se qualquer fonte estiver indisponível, lança —
 * uma fonte ausente nunca pode virar "todo mundo cancelou".
 */
export async function buildBillingEntities(organizationId: string): Promise<LegacyImportEntity[]> {
  const [connection, stripeLifecycle] = await Promise.all([
    readConnection(organizationId),
    fetchStripeLifecycleSnapshot(),
  ]);
  if (!connection) throw new Error("Billing não configurado.");
  if (!stripeLifecycle) throw new Error("Stripe direta não configurada.");

  const billing = await fetchBillingRaw(connection.token);
  if (!billing.other.ok) throw new Error(`Billing v2 indisponível: ${billing.other.error}.`);

  return agruparEntidades([
    ...evidencesFromOther(billing.other.data as OtherExport),
    ...stripeLifecycle.active.map(evidenceFromStripe),
    ...stripeLifecycle.pastDue.map(evidenceFromStripe),
    ...stripeLifecycle.canceled.map(evidenceFromStripe),
  ]);
}
