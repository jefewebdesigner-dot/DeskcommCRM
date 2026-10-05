import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { buildBillingEntities } from "./legacy-import";
import {
  chaveDeEtapa,
  ORIGENS_DE_CARD_DO_SISTEMA,
  planejar,
  type CardDoBanco,
  type ContatoDoBanco,
  type DestinosDoBanco,
  type Operacao,
} from "./legacy-apply";

/**
 * Sincronização contínua do billing vivo (Stripe + PIX/manual) com o CRM.
 *
 * O estado financeiro é FATO e mora no contato (`custom_fields.financeiro`, com
 * TODAS as assinaturas — assinatura não é pessoa); o cartão do funil só se move
 * quando a pessoa está no funil errado. A regra (mesma da migração histórica, em
 * `legacy-apply.ts`, que é quem decide):
 *
 *   ativo      → Pós-vendas / Cliente ativo
 *   vencido    → Inadimplência e Retenção / Vencido
 *   cancelado  → Inadimplência e Retenção / Cancelados para recuperar (etapa ABERTA)
 *
 * Billing NUNCA cria cliente pagante como `won` em Vendas. Antes, cada assinatura
 * virava um card ganho/perdido no funil padrão e toda rodada diária recolocava os
 * cards lá — desfazendo qualquer reclassificação.
 *
 * Fail-closed: `buildBillingEntities` lança se qualquer fonte estiver
 * indisponível. Uma fonte ausente nunca pode virar "todo mundo cancelou".
 */

type Admin = ReturnType<typeof createAdminClient>;

export interface SyncResult {
  configured: boolean;
  contactsCreated: number;
  contactsUpdated: number;
  dealsCreated: number;
  dealsUpdated: number;
  dealsMoved: number;
  conflicts: number;
  errors: number;
  /** Até 5 mensagens de erro reais da rodada — vazio quando não houve nenhum. */
  sampleErrors: string[];
}

const PAGINA = 1000;

async function paginar<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const todos: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    const linhas = (data ?? []) as T[];
    todos.push(...linhas);
    if (linhas.length < PAGINA) return todos;
  }
}

async function carregarDestinos(admin: Admin, organizationId: string): Promise<{ destinos: DestinosDoBanco; slugPorEtapa: Map<string, string> }> {
  const { data: funis, error } = await admin
    .from("crm_pipelines")
    .select("id, settings")
    .eq("organization_id", organizationId)
    .eq("is_archived", false);
  if (error) throw new Error(error.message);
  // Chave pelo NOME, nunca pelo slug: no funil de Vendas as etapas foram renomeadas e mantêm o slug histórico.
  const etapasBrutas = await paginar<{ id: string; pipeline_id: string; name: string }>((de, ate) =>
    admin.from("crm_stages").select("id, pipeline_id, name").eq("organization_id", organizationId).eq("is_archived", false).range(de, ate),
  );
  const etapas = etapasBrutas.map((e) => ({ id: e.id, pipeline_id: e.pipeline_id, slug: chaveDeEtapa(e.name) }));
  const slugPorEtapa = new Map(etapas.map((e) => [e.id, e.slug]));
  const destinos: DestinosDoBanco = {};
  for (const f of (funis ?? []) as Array<{ id: string; settings: Record<string, unknown> | null }>) {
    const kind = f.settings?.operational_kind;
    if (typeof kind !== "string") continue;
    destinos[kind] = {
      pipelineId: f.id,
      etapas: Object.fromEntries(etapas.filter((e) => e.pipeline_id === f.id).map((e) => [e.slug, e.id])),
    };
  }
  return { destinos, slugPorEtapa };
}

async function executar(admin: Admin, organizationId: string, ops: Operacao[], result: SyncResult): Promise<void> {
  const contatoDeEntidade = new Map<string, string>();
  const registrarErro = (e: unknown) => {
    result.errors++;
    if (result.sampleErrors.length < 5) result.sampleErrors.push(e instanceof Error ? e.message : String(e));
  };

  for (const op of ops) {
    try {
      if (op.op === "inserir_contato") {
        const { data, error } = await admin
          .from("contacts")
          .insert({ organization_id: organizationId, ...op.valores })
          .select("id")
          .maybeSingle();
        if (error) throw new Error(error.message);
        contatoDeEntidade.set(op.entityId, (data as { id: string }).id);
        result.contactsCreated++;
      } else if (op.op === "atualizar_contato") {
        const { error } = await admin.from("contacts").update(op.patch).eq("organization_id", organizationId).eq("id", op.contatoId);
        if (error) throw new Error(error.message);
        result.contactsUpdated++;
      } else if (op.op === "inserir_card") {
        const contactId = op.contatoId ?? contatoDeEntidade.get(op.entityId);
        if (!contactId) throw new Error("contato do card não resolvido");
        const { error } = await admin.from("crm_leads").insert({
          organization_id: organizationId,
          pipeline_id: op.pipelineId,
          stage_id: op.stageId,
          contact_id: contactId,
          status: "open",
          position_in_stage: Date.now(),
          ...op.valores,
        });
        if (error && error.code !== "23505") throw new Error(error.message);
        if (!error) result.dealsCreated++;
      } else if (op.op === "mover_card") {
        const { error } = await admin
          .from("crm_leads")
          .update({
            pipeline_id: op.pipelineId,
            stage_id: op.stageId,
            lost_reason: null,
            position_in_stage: Date.now(),
            source_metadata: op.source_metadata,
            tags: op.tags,
          })
          .eq("organization_id", organizationId)
          .eq("id", op.cardId);
        if (error) throw new Error(error.message);
        result.dealsMoved++;
      } else if (op.op === "atualizar_card") {
        const { error } = await admin
          .from("crm_leads")
          .update({ source_metadata: op.source_metadata, tags: op.tags })
          .eq("organization_id", organizationId)
          .eq("id", op.cardId);
        if (error) throw new Error(error.message);
        result.dealsUpdated++;
      } else {
        // `absorver_card` apaga um card: só a importação histórica faz isso, com
        // backup e conferência. O sincronizador diário nunca apaga nada.
        logger.warn("[billing→crm] card duplicado mantido (absorção é da importação)", { organization_id: organizationId, card_id: op.cardId });
      }
    } catch (e) {
      registrarErro(e);
    }
  }
}

/**
 * A metade de aplicar — comum a TODA fonte de billing (bridge do admin
 * legado + Stripe direta, ou qualquer provedor direto como AbacatePay). Quem
 * muda entre fontes é só `entidades`; `planejar`/`executar` e o destino no
 * funil são os mesmos, de propósito: duas fontes com a mesma classificação
 * divergindo seria exatamente o "duas fontes de verdade" que esta função
 * existe para evitar.
 */
export async function applyBillingEntitiesToCrm(
  organizationId: string,
  entidades: Awaited<ReturnType<typeof buildBillingEntities>>,
): Promise<SyncResult> {
  const result: SyncResult = {
    configured: true,
    contactsCreated: 0,
    contactsUpdated: 0,
    dealsCreated: 0,
    dealsUpdated: 0,
    dealsMoved: 0,
    conflicts: 0,
    errors: 0,
    sampleErrors: [],
  };

  const admin = createAdminClient();
  const { destinos, slugPorEtapa } = await carregarDestinos(admin, organizationId);
  for (const f of ["post_sales", "retention"]) {
    if (!destinos[f]) throw new Error(`Funil operacional ausente: ${f}`);
  }

  const contatos = await paginar<ContatoDoBanco>((de, ate) =>
    admin
      .from("contacts")
      .select("id, email_normalized, phone_number, tags, source, source_metadata, custom_fields, client_recognized_at, client_tag_by_system")
      .eq("organization_id", organizationId)
      .is("is_merged_into", null)
      .range(de, ate),
  );
  const brutos = await paginar<Omit<CardDoBanco, "stage_slug">>((de, ate) =>
    admin
      .from("crm_leads")
      .select("id, contact_id, pipeline_id, stage_id, status, created_at, source, external_id, source_metadata, tags, value_cents")
      .eq("organization_id", organizationId)
      .in("source", [...ORIGENS_DE_CARD_DO_SISTEMA])
      .range(de, ate),
  );
  const cards: CardDoBanco[] = brutos.map((c) => ({ ...c, stage_slug: slugPorEtapa.get(c.stage_id) ?? "" }));

  const plano = planejar("sync", entidades, contatos, cards, destinos, new Date().toISOString());
  result.conflicts = plano.conflitos.length;
  if (plano.conflitos.length) {
    logger.warn("[billing→crm] pessoas com identidade em contatos diferentes (não tocadas)", {
      organization_id: organizationId,
      quantidade: plano.conflitos.length,
    });
  }

  await executar(admin, organizationId, plano.ops, result);
  return result;
}

/** A fonte original (bridge do admin legado + Stripe direta) — mantida para quem já chamava esta função. */
export async function syncBillingToCrm(organizationId: string): Promise<SyncResult> {
  const entidades = await buildBillingEntities(organizationId).catch((e: unknown) => {
    // Billing não conectado é "não configurado", não erro; as demais falhas sobem (fail-closed).
    if (e instanceof Error && e.message === "Billing não configurado.") return null;
    throw e;
  });
  if (!entidades) {
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
  return applyBillingEntitiesToCrm(organizationId, entidades);
}
