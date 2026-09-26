/** Dados inteiramente sintéticos. Nunca substituir por export real de clientes. */
export const stripeBillingFixture = {
  generatedAt: "2026-09-25T12:00:00Z",
  summary: {
    mrr: 149.9,
    arr: 1798.8,
    activeCount: 2,
    pastDueCount: 1,
    churnedTotal: 3,
    churnedLast90d: 1,
    churnRate90d: 10,
    totalEverRevenue: 900,
    arpu: 74.95,
    cancelingCount: 1,
    planBreakdown: { Professional: { count: 2, mrr: 149.9 } },
  },
  monthlyData: [
    { month: "2026-08", revenue: 99.9, newSubs: 1, churnedSubs: 0 },
    { month: "2026-09", revenue: 149.9, newSubs: 1, churnedSubs: 1 },
  ],
  upcomingRenewals: [
    {
      name: "Cliente sintético Stripe",
      email: "stripe@example.test",
      renewsAt: "2026-10-01T12:00:00Z",
      cancelAtPeriodEnd: true,
    },
  ],
  recentPayments: [
    {
      name: "Cliente sintético Stripe",
      email: "stripe@example.test",
      amount: 149.9,
      date: "2026-09-24T12:00:00Z",
    },
  ],
  pastDueCustomers: [{ name: "Cliente sintético em atraso", email: "atraso@example.test" }],
};
export const otherBillingFixture = {
  version: 2 as const,
  generatedAt: "2026-09-25T12:00:00Z",
  source: "operational",
  summary: {
    activeCustomers: 1,
    delinquentCustomers: 1,
    activeMrrMinor: 9990,
    mrrAtRiskMinor: 9990,
  },
  customers: [
    {
      provider: "manual" as const,
      externalId: "customer-1",
      name: "Cliente sintético PIX",
      email: "pix@example.test",
      createdAt: "2026-09-01T12:00:00Z",
    },
  ],
  subscriptions: [
    {
      provider: "manual" as const,
      externalId: "sub-1",
      customerExternalId: "customer-1",
      status: "past_due",
      billingMode: "manual_pix",
      amountMinor: 9990,
      currency: "brl",
      billingInterval: "month",
      intervalCount: 1,
      mrrMinor: 9990,
      currentPeriodEnd: "2026-09-20T12:00:00Z",
    },
  ],
  payments: [
    {
      provider: "manual" as const,
      externalId: "pay-1",
      customerExternalId: "customer-1",
      subscriptionExternalId: "sub-1",
      status: "paid",
      amountDueMinor: 9990,
      amountPaidMinor: 9990,
      currency: "brl",
      paidAt: "2026-09-01T12:00:00Z",
      dueAt: null,
      createdAt: "2026-09-01T12:00:00Z",
    },
  ],
};
