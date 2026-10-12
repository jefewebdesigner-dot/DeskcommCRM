import { createAdminClient } from "@/lib/supabase/admin";

// Conciliação funil × financeiro — trazida do Gravity CRM (crm.ia, lib/revops)
// na fusão. A classificação é a mesma, função pura; a leitura passou a ser
// paginada (o PostgREST corta em 1000 linhas calado, e base grande ficaria
// com números errados sem aviso).

export type ReconciliationLead = {
  id: string;
  contactId: string | null;
  stageId: string;
  status: string;
  source: string;
};

export type ReconciliationStage = {
  id: string;
  name: string;
  isWon: boolean;
  isLost: boolean;
};

export type ReconciliationAccount = {
  id: string;
  contactId: string | null;
};

export type ReconciliationSubscription = {
  accountId: string;
  status: string;
  source: string;
};

export type ReconciliationIssue = {
  key: string;
  label: string;
  count: number;
  explanation: string;
  source: string;
  recommendation: string;
  tone: "error" | "warning" | "info" | "neutral";
};

export type RevenueReconciliation = {
  counts: {
    validLeads: number;
    pendingPayment: number;
    activeCustomers: number;
    delinquentCustomers: number;
    cancelingCustomers: number;
    canceledCustomers: number;
  };
  quality: {
    rawLeadRecords: number;
    uniqueLeadContacts: number;
    contactsWithMultipleLeads: number;
    leadsWithoutContact: number;
    legacyBackfill: number;
    accountsWithoutContact: number;
    activeCustomersInOpenFunnel: number;
    wonWithoutCurrentCustomer: number;
    financialLifecycleCards: number;
  };
  issues: ReconciliationIssue[];
  financialSources: string[];
  commercialSources: Array<{ source: string; count: number }>;
  stages: Array<{ name: string; count: number; terminal: "won" | "lost" | "open" }>;
};

const FINANCIAL_MIRROR_SOURCES = new Set([
  "stripe",
  "abacatepay",
  "peritoia-backfill",
  "peritoia-webhook",
  "periciaia",
]);

const financialStatus = (
  accountId: string,
  subscriptionsByAccount: Map<string, ReconciliationSubscription[]>,
) => {
  const statuses = new Set((subscriptionsByAccount.get(accountId) ?? []).map((row) => row.status));
  if (statuses.has("past_due")) return "past_due";
  if (statuses.has("canceling")) return "canceling";
  if (statuses.has("active")) return "active";
  if (statuses.has("canceled")) return "canceled";
  return "unknown";
};

export function classifyRevenuePopulation(input: {
  leads: ReconciliationLead[];
  stages: ReconciliationStage[];
  accounts: ReconciliationAccount[];
  subscriptions: ReconciliationSubscription[];
}): RevenueReconciliation {
  const { leads, stages, accounts, subscriptions } = input;
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const subscriptionsByAccount = new Map<string, ReconciliationSubscription[]>();
  for (const subscription of subscriptions) {
    const rows = subscriptionsByAccount.get(subscription.accountId) ?? [];
    rows.push(subscription);
    subscriptionsByAccount.set(subscription.accountId, rows);
  }

  const accountsByStatus = {
    active: accounts.filter((row) => financialStatus(row.id, subscriptionsByAccount) === "active"),
    past_due: accounts.filter(
      (row) => financialStatus(row.id, subscriptionsByAccount) === "past_due",
    ),
    canceling: accounts.filter(
      (row) => financialStatus(row.id, subscriptionsByAccount) === "canceling",
    ),
    canceled: accounts.filter(
      (row) => financialStatus(row.id, subscriptionsByAccount) === "canceled",
    ),
  };
  const currentCustomerContacts = new Set(
    [...accountsByStatus.active, ...accountsByStatus.past_due, ...accountsByStatus.canceling]
      .map((row) => row.contactId)
      .filter((id): id is string => Boolean(id)),
  );
  const openLeads = leads.filter((lead) => {
    const stage = stageById.get(lead.stageId);
    return stage && !stage.isWon && !stage.isLost;
  });
  const wonLeads = leads.filter((lead) => stageById.get(lead.stageId)?.isWon);
  const validLeadContacts = new Set(
    openLeads
      .filter(
        (lead) =>
          lead.contactId &&
          !currentCustomerContacts.has(lead.contactId) &&
          !FINANCIAL_MIRROR_SOURCES.has(lead.source),
      )
      .map((lead) => lead.contactId as string),
  );
  const pendingPaymentContacts = new Set(
    wonLeads
      .filter((lead) => lead.contactId && !currentCustomerContacts.has(lead.contactId))
      .map((lead) => lead.contactId as string),
  );
  const leadsByContact = new Map<string, number>();
  for (const lead of leads) {
    if (!lead.contactId) continue;
    leadsByContact.set(lead.contactId, (leadsByContact.get(lead.contactId) ?? 0) + 1);
  }
  const activeCustomersInOpenFunnel = new Set(
    openLeads
      .filter((lead) => lead.contactId && currentCustomerContacts.has(lead.contactId))
      .map((lead) => lead.contactId as string),
  ).size;
  const financialLifecycleCards = leads.filter((lead) => {
    const stage = stageById.get(lead.stageId);
    return Boolean(stage && /ativ|inadimpl|cancel/i.test(stage.name));
  }).length;
  const legacyBackfill = leads.filter((lead) => lead.source === "peritoia-backfill").length;
  const accountsWithoutContact = accounts.filter((row) => !row.contactId).length;
  const wonWithoutCurrentCustomer = pendingPaymentContacts.size;
  const quality = {
    rawLeadRecords: leads.length,
    uniqueLeadContacts: leadsByContact.size,
    contactsWithMultipleLeads: [...leadsByContact.values()].filter((count) => count > 1).length,
    leadsWithoutContact: leads.filter((lead) => !lead.contactId).length,
    legacyBackfill,
    accountsWithoutContact,
    activeCustomersInOpenFunnel,
    wonWithoutCurrentCustomer,
    financialLifecycleCards,
  };
  const issues = [
    {
      key: "orphan_leads",
      label: "Leads sem contato",
      count: quality.leadsWithoutContact,
      explanation: "Cards do funil sem pessoa identificada não entram na conversão comercial.",
      source: "CRM",
      recommendation: "Reconciliar identidade",
      tone: "error",
    },
    {
      key: "legacy_backfill",
      label: "Backfill antigo no funil",
      count: quality.legacyBackfill,
      explanation: "Histórico financeiro importado está misturado a oportunidades comerciais.",
      source: "PeritoIA → CRM",
      recommendation: "Separar histórico",
      tone: "warning",
    },
    {
      key: "active_in_open_funnel",
      label: "Clientes atuais em funil aberto",
      count: quality.activeCustomersInOpenFunnel,
      explanation:
        "A fonte financeira confirma cliente atual, mas o CRM ainda o trata como negociação.",
      source: "CRM × financeiro",
      recommendation: "Encerrar aquisição",
      tone: "warning",
    },
    {
      key: "won_without_customer",
      label: "Ganhos sem cliente atual",
      count: quality.wonWithoutCurrentCustomer,
      explanation: "Negócio ganho sem assinatura ativa, inadimplente ou cancelando confirmada.",
      source: "CRM × financeiro",
      recommendation: "Confirmar pagamento",
      tone: "info",
    },
    {
      key: "unlinked_accounts",
      label: "Contas financeiras sem contato",
      count: quality.accountsWithoutContact,
      explanation:
        "A receita foi preservada, mas ainda não existe vínculo com o relacionamento do CRM.",
      source: "Financeiro",
      recommendation: "Vincular contato",
      tone: "neutral",
    },
    {
      key: "financial_cards",
      label: "Estados financeiros usados como etapa",
      count: quality.financialLifecycleCards,
      explanation: "Ativo, inadimplente e cancelado não devem disputar espaço com etapas de venda.",
      source: "CRM",
      recommendation: "Separar ciclo",
      tone: "warning",
    },
  ] satisfies ReconciliationIssue[];
  issues.sort((a, b) => b.count - a.count);

  const sourceCounts = leads.reduce<Map<string, number>>((acc, lead) => {
    acc.set(lead.source, (acc.get(lead.source) ?? 0) + 1);
    return acc;
  }, new Map());
  return {
    counts: {
      validLeads: validLeadContacts.size,
      pendingPayment: pendingPaymentContacts.size,
      activeCustomers: accountsByStatus.active.length,
      delinquentCustomers: accountsByStatus.past_due.length,
      cancelingCustomers: accountsByStatus.canceling.length,
      canceledCustomers: accountsByStatus.canceled.length,
    },
    quality,
    issues,
    financialSources: [...new Set(subscriptions.map((row) => row.source))].sort(),
    commercialSources: [...sourceCounts.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count),
    stages: stages
      .map((stage) => ({
        name: stage.name,
        count: leads.filter((lead) => lead.stageId === stage.id).length,
        terminal: stage.isWon
          ? ("won" as const)
          : stage.isLost
            ? ("lost" as const)
            : ("open" as const),
      }))
      .filter((stage) => stage.count > 0)
      .sort((a, b) => b.count - a.count),
  };
}

const PAGINA = 1000;
// Lê todas as páginas de uma consulta (para quando a tabela pode passar de 1000 linhas).
export async function lerTudo<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[]; error: unknown }> {
  const todas: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const r = await pagina(de, de + PAGINA - 1);
    if (r.error) return { data: todas, error: r.error };
    const linhas = r.data ?? [];
    todas.push(...linhas);
    if (linhas.length < PAGINA) return { data: todas, error: null };
  }
}

export async function loadRevenueReconciliation(organizationId: string) {
  const admin = createAdminClient();
  const [leadResult, stageResult, accountResult, subscriptionResult] = await Promise.all([
    lerTudo((de, ate) =>
      admin
        .from("crm_leads")
        .select("id, contact_id, stage_id, status, source")
        .eq("organization_id", organizationId)
        .order("id")
        .range(de, ate),
    ),
    admin
      .from("crm_stages")
      .select("id, name, is_won, is_lost")
      .eq("organization_id", organizationId),
    admin.from("saas_accounts").select("id, contact_id").eq("organization_id", organizationId),
    admin
      .from("revenue_subscription_states")
      .select("account_id, status, source")
      .eq("organization_id", organizationId)
      .not("account_id", "is", null),
  ]);
  for (const result of [leadResult, stageResult, accountResult, subscriptionResult]) {
    if (result.error) throw result.error;
  }
  return classifyRevenuePopulation({
    leads: (leadResult.data ?? []).map((row) => ({
      id: row.id,
      contactId: row.contact_id,
      stageId: row.stage_id,
      status: row.status,
      source: row.source,
    })),
    stages: (stageResult.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      isWon: row.is_won,
      isLost: row.is_lost,
    })),
    accounts: (accountResult.data ?? []).map((row) => ({ id: row.id, contactId: row.contact_id })),
    subscriptions: (subscriptionResult.data ?? []).map((row) => ({
      accountId: row.account_id!,
      status: row.status,
      source: row.source,
    })),
  });
}
