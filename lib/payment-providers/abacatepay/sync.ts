import "server-only";

import { agruparEntidades, evidencesFromOther } from "@/lib/billing-export/legacy-import";
import { normalizeOther } from "@/lib/billing-export/contracts";
import { applyBillingEntitiesToCrm, type SyncResult } from "@/lib/billing-export/crm-sync";
import { listCheckouts, listCustomers } from "./client";
import { buildAbacatePayExport } from "./export";
import { readConnection } from "./config";

/** O dashboard ao vivo (contrato `OtherDashboard`, o mesmo da tela de Assinaturas). */
export async function fetchAbacatePayDashboard(apiKey: string) {
  const [customers, checkouts] = await Promise.all([listCustomers(apiKey), listCheckouts(apiKey)]);
  return normalizeOther(buildAbacatePayExport(customers, checkouts));
}

/**
 * Sincroniza a AbacatePay direta com o CRM, reaproveitando o MESMO pipeline
 * de classificação/aplicação de `lib/billing-export/crm-sync.ts` (destino no
 * funil, merge com contato existente, conflitos) — só a coleta é própria.
 */
export async function syncAbacatePayToCrm(organizationId: string): Promise<SyncResult> {
  const connection = await readConnection(organizationId);
  if (!connection) {
    return {
      configured: false,
      contactsCreated: 0,
      contactsUpdated: 0,
      dealsCreated: 0,
      dealsUpdated: 0,
      dealsMoved: 0,
      conflicts: 0,
      errors: 0,
      sampleErrors: [],
    };
  }
  const [customers, checkouts] = await Promise.all([
    listCustomers(connection.apiKey),
    listCheckouts(connection.apiKey),
  ]);
  const exportado = buildAbacatePayExport(customers, checkouts);
  const entidades = agruparEntidades(evidencesFromOther(exportado));
  return applyBillingEntitiesToCrm(organizationId, entidades);
}
