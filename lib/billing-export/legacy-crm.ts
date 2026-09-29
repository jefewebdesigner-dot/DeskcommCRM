import "server-only";

import { readConnection } from "./config";

const DEFAULT_EXPORT_URL =
  "https://saaspericia2026-jefersonsantt30.vercel.app/api/admin/crm-export";

interface LegacyStage {
  key?: string | null;
  label?: string | null;
  name?: string | null;
  fixed?: boolean;
}

interface LegacyLead {
  uid?: string | null;
  email?: string | null;
  displayName?: string | null;
  phone?: string | null;
  crmStage?: string | null;
  source?: string | null;
  convertido?: boolean;
  isArchived?: boolean;
  lossReason?: string | null;
}

interface LegacyUser {
  uid?: string | null;
  email?: string | null;
  displayName?: string | null;
  phone?: string | null;
  crmStage?: string | null;
  funnelType?: string | null;
  planStatus?: string | null;
  paymentProvider?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  abacatepayCustomerId?: string | null;
  abacatepaySubscriptionId?: string | null;
  isArchived?: boolean;
}

export interface LegacyCrmExport {
  generatedAt?: string;
  counts?: {
    leads?: number;
    users?: number;
    teamMembersExcluded?: number;
  };
  stages?: LegacyStage[];
  leads?: LegacyLead[];
  users?: LegacyUser[];
}

function countBy(values: Array<string | null | undefined>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) {
    const key = value && value.trim() ? value.trim() : "(sem valor)";
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

export async function fetchLegacyCrmExport(
  organizationId: string,
): Promise<{ configured: boolean; data: LegacyCrmExport | null }> {
  const connection = await readConnection(organizationId);
  if (!connection) return { configured: false, data: null };

  const url = process.env.PERICIAIA_CRM_EXPORT_URL?.trim() || DEFAULT_EXPORT_URL;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${connection.token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`CRM legado respondeu HTTP ${response.status}.`);
  }

  const data = (await response.json()) as LegacyCrmExport;
  if (!Array.isArray(data.leads) || !Array.isArray(data.users)) {
    throw new Error("CRM legado retornou payload inválido.");
  }

  return { configured: true, data };
}

export function summarizeLegacyCrm(data: LegacyCrmExport) {
  const leads = data.leads ?? [];
  const users = data.users ?? [];

  const leadEmails = new Set(
    leads.map((x) => x.email?.trim().toLowerCase()).filter((x): x is string => Boolean(x)),
  );
  const userEmails = new Set(
    users.map((x) => x.email?.trim().toLowerCase()).filter((x): x is string => Boolean(x)),
  );
  const overlappingEmails = [...leadEmails].filter((email) => userEmails.has(email)).length;

  return {
    generatedAt: data.generatedAt ?? null,
    counts: {
      whatsappLeads: leads.length,
      users: users.length,
      teamMembersExcluded: data.counts?.teamMembersExcluded ?? 0,
      convertedWhatsappLeads: leads.filter((x) => x.convertido).length,
      archivedWhatsappLeads: leads.filter((x) => x.isArchived).length,
      archivedUsers: users.filter((x) => x.isArchived).length,
      leadsWithEmail: leadEmails.size,
      usersWithEmail: userEmails.size,
      overlappingEmails,
    },
    pipelineStages: data.stages ?? [],
    whatsappStages: countBy(leads.map((x) => x.crmStage)),
    userStages: countBy(users.map((x) => x.crmStage)),
    userFunnels: countBy(users.map((x) => x.funnelType)),
    planStatus: countBy(users.map((x) => x.planStatus)),
    paymentProviders: countBy(users.map((x) => x.paymentProvider)),
    paymentIdentifiers: {
      stripeCustomers: users.filter((x) => Boolean(x.stripeCustomerId)).length,
      stripeSubscriptions: users.filter((x) => Boolean(x.stripeSubscriptionId)).length,
      abacatepayCustomers: users.filter((x) => Boolean(x.abacatepayCustomerId)).length,
      abacatepaySubscriptions: users.filter((x) => Boolean(x.abacatepaySubscriptionId)).length,
    },
  };
}
