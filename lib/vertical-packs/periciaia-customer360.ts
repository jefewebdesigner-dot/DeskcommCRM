import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export const PERICIAIA_ORGANIZATION_ID =
  "9563e071-406b-4db2-aaa4-d08846d3267b";

type ContactRow = {
  id: string;
  name: string | null;
  email: string | null;
  custom_fields: Record<string, unknown> | null;
};

type FinanceSubscription = {
  provider?: unknown;
  customerId?: unknown;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function periciaiaIdentities(
  contact: Pick<ContactRow, "id" | "custom_fields">,
) {
  const fields = contact.custom_fields ?? {};
  const financeiro = (fields.financeiro ?? {}) as { assinaturas?: unknown };
  const legacy = (fields.legacy ?? {}) as { user_ids?: unknown };
  const subscriptions = Array.isArray(financeiro.assinaturas)
    ? (financeiro.assinaturas as FinanceSubscription[])
    : [];

  const identities: Array<{ source: string; externalCustomerId: string }> = [];
  const seen = new Set<string>();

  for (const subscription of subscriptions) {
    const provider = text(subscription.provider)?.toLowerCase();
    const customerId = text(subscription.customerId);
    if (!provider || !customerId) continue;

    const source = provider
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 50);
    if (!source) continue;

    const key = source + "|" + customerId;
    if (seen.has(key)) continue;
    seen.add(key);
    identities.push({ source, externalCustomerId: customerId });
  }

  if (Array.isArray(legacy.user_ids)) {
    for (const raw of legacy.user_ids) {
      const userId = text(raw);
      if (!userId) continue;
      const key = "periciaia|" + userId;
      if (seen.has(key)) continue;
      seen.add(key);
      identities.push({ source: "periciaia", externalCustomerId: userId });
    }
  }

  return identities;
}

export async function reconcilePericiaiaCustomer360(
  organizationId = PERICIAIA_ORGANIZATION_ID,
) {
  if (organizationId !== PERICIAIA_ORGANIZATION_ID) {
    throw new Error("A fusão deve preservar a organização PeríciaIA existente.");
  }

  const admin = createAdminClient();
  const pageSize = 500;
  let scanned = 0;
  let eligible = 0;
  let accountsCreated = 0;
  let accountsReused = 0;
  let identitiesLinked = 0;

  for (let from = 0; ; from += pageSize) {
    const result = await admin
      .from("contacts")
      .select("id,name,email,custom_fields")
      .eq("organization_id", organizationId)
      .is("is_merged_into", null)
      .range(from, from + pageSize - 1);

    if (result.error) throw result.error;
    const contacts = (result.data ?? []) as ContactRow[];
    scanned += contacts.length;

    for (const contact of contacts) {
      const identities = periciaiaIdentities(contact);
      const hasBillingIdentity = identities.some(
        (identity) => identity.source !== "periciaia",
      );
      if (!hasBillingIdentity) continue;
      eligible++;

      const existing = await admin
        .from("saas_accounts")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("contact_id", contact.id)
        .maybeSingle();
      if (existing.error) throw existing.error;

      let accountId: string;
      if (existing.data?.id) {
        accountId = String(existing.data.id);
        accountsReused++;
      } else {
        const created = await admin
          .from("saas_accounts")
          .insert({
            organization_id: organizationId,
            contact_id: contact.id,
            display_name: contact.name ?? contact.email ?? "Cliente PeríciaIA",
          })
          .select("id")
          .single();

        if (created.error || !created.data) {
          throw created.error ?? new Error("Não foi possível criar a conta SaaS.");
        }
        accountId = String(created.data.id);
        accountsCreated++;
      }

      for (const identity of identities) {
        const linked = await admin.from("saas_account_identities").upsert(
          {
            organization_id: organizationId,
            account_id: accountId,
            source: identity.source,
            external_customer_id: identity.externalCustomerId,
          },
          {
            onConflict: "organization_id,source,external_customer_id",
            ignoreDuplicates: false,
          },
        );
        if (linked.error) throw linked.error;
        identitiesLinked++;
      }
    }

    if (contacts.length < pageSize) break;
  }

  return {
    scanned,
    eligible,
    accountsCreated,
    accountsReused,
    identitiesLinked,
  };
}
