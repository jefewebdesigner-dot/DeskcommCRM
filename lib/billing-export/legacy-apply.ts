/**
 * Planejador PURO da migração histórica e do sincronizador contínuo de billing.
 *
 * Recebe as pessoas (`LegacyImportEntity`, já deduplicadas) e o estado atual do
 * banco e devolve a lista de operações — nada é lido nem escrito aqui. Quem
 * executa é o script de importação (SQL direto, dono do banco) ou o
 * sincronizador (cliente admin). Como o planejador é puro, a idempotência é
 * provada por teste: aplicar as operações e planejar de novo dá ZERO operações.
 *
 * Regras (decididas pelo dono do produto):
 *  - contato é uma pessoa única: nunca duplicar; assinatura NÃO é pessoa;
 *  - fonte de verdade do estado financeiro = billing VIVO (Stripe + AbacatePay +
 *    manual), nunca o `planStatus` do Firestore antigo;
 *  - ativo → Pós-vendas / Cliente ativo · vencido → Retenção / Vencido ·
 *    cancelado → Retenção / Cancelados para recuperar (etapa ABERTA) ·
 *    lead recuperável → Vendas / Primeiro contato;
 *  - billing nunca mais cria cliente pago como `won` em Vendas;
 *  - card só é movido quando está no funil errado (ou numa etapa de saída que
 *    contradiz o estado atual): quem já está no funil certo, em qualquer etapa,
 *    mantém o progresso que a equipe deu;
 *  - a importação NÃO fala com ninguém: todo contato importado carrega as marcas
 *    de `lib/leads/importacao-legado.ts` (tag durável, nunca só `source_metadata`,
 *    que o sincronizador antigo regravava inteiro).
 */
import type { LegacyImportBucket, LegacyImportEntity } from "./legacy-import";
import {
  ORIGEM_IMPORTACAO_LEGADO,
  TAG_IMPORTACAO_LEGADO,
  TAG_REVISAO_SEM_CONTATO,
} from "@/lib/leads/importacao-legado";

/** Contato do sistema sem NENHUMA evidência no billing vivo nem no CRM legado: fica marcado para revisão humana. */
export const TAG_REVISAO_BILLING = "revisao_billing";

export type FunilAlvo = "sales" | "post_sales" | "retention";
export type ModoDePlano = "importacao" | "sync";

/** Cards que o sistema é dono (podem ser reclassificados/absorvidos). Card criado à mão ou pelo WhatsApp nunca. */
export const ORIGENS_DE_CARD_DO_SISTEMA = [
  "periciaia_billing",
  "periciaia_billing_stripe_amostra",
  ORIGEM_IMPORTACAO_LEGADO,
] as const;

export const DESTINO_POR_BUCKET: Record<LegacyImportBucket, { funil: FunilAlvo; etapa: string }> = {
  active: { funil: "post_sales", etapa: "cliente_ativo" },
  past_due: { funil: "retention", etapa: "vencido" },
  canceled: { funil: "retention", etapa: "cancelados_para_recuperar" },
  lead: { funil: "sales", etapa: "primeiro_contato" },
};

/** Etapas de onde o estado atual manda a pessoa de volta à etapa de entrada do destino. */
export const REENTRADA: Record<LegacyImportBucket, readonly string[]> = {
  active: ["encerrado"],
  past_due: ["regularizado", "cancelado", "cancelados_para_recuperar"],
  canceled: ["regularizado", "proximo_do_vencimento", "vencido"],
  lead: ["perdido", "assinante_ativo"],
};

const TAG_POR_BUCKET: Record<LegacyImportBucket, string | null> = {
  active: "cliente",
  past_due: "inadimplente",
  canceled: "ex-cliente",
  lead: "lead-antigo",
};

/**
 * Chave estável de uma etapa, derivada do NOME (sem acento, minúsculo, `_`).
 * Não usa `crm_stages.slug`: no funil de Vendas do PeríciaIA as etapas foram
 * renomeadas mas mantêm o slug histórico do modelo de e-commerce (ex.: "Primeiro
 * contato" tem slug `aguardando_pagamento`). O nome é o que o modelo operacional
 * (`funis-operacionais.ts`) define.
 */
export function chaveDeEtapa(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export interface DestinosDoBanco {
  /** funil (kind) → id do funil e ids das etapas por slug. */
  [funil: string]: { pipelineId: string; etapas: Record<string, string> } | undefined;
}

export interface ContatoDoBanco {
  id: string;
  email_normalized: string | null;
  phone_number: string | null;
  tags: string[];
  source: string;
  source_metadata: Record<string, unknown>;
  custom_fields: Record<string, unknown>;
  client_recognized_at: string | null;
  client_tag_by_system: string | null;
}

export interface CardDoBanco {
  id: string;
  contact_id: string | null;
  pipeline_id: string;
  stage_id: string;
  stage_slug: string;
  status: string;
  created_at: string;
  source: string;
  external_id: string | null;
  source_metadata: Record<string, unknown>;
  tags: string[];
  value_cents: number | null;
}

export interface PatchDeContato {
  tags?: string[];
  source_metadata?: Record<string, unknown>;
  custom_fields?: Record<string, unknown>;
  client_recognized_at?: string;
  client_tag_by_system?: string;
  email?: string;
  phone_number?: string;
}

export type Operacao =
  | {
      op: "inserir_contato";
      entityId: string;
      valores: {
        name: string | null;
        email: string | null;
        phone_number: string | null;
        tags: string[];
        source: string;
        source_metadata: Record<string, unknown>;
        custom_fields: Record<string, unknown>;
        client_recognized_at: string | null;
        client_tag_by_system: string | null;
      };
    }
  | { op: "atualizar_contato"; entityId: string; contatoId: string; patch: PatchDeContato }
  | {
      op: "inserir_card";
      entityId: string;
      contatoId: string | null; // null = contato novo desta mesma rodada (resolvido por entityId)
      pipelineId: string;
      stageId: string;
      valores: {
        title: string;
        source: string;
        external_id: string;
        source_metadata: Record<string, unknown>;
        tags: string[];
      };
    }
  | {
      op: "mover_card";
      entityId: string;
      cardId: string;
      pipelineId: string;
      stageId: string;
      source_metadata: Record<string, unknown>;
      tags: string[];
    }
  | { op: "atualizar_card"; entityId: string; cardId: string; source_metadata: Record<string, unknown>; tags: string[] }
  | { op: "absorver_card"; entityId: string; cardId: string; nocardId: string; absorvido: Record<string, unknown> };

export interface Conflito {
  entityId: string;
  motivo: "contatos_diferentes_para_a_mesma_pessoa";
  contatoIds: string[];
}

export interface ResultadoDoPlano {
  ops: Operacao[];
  conflitos: Conflito[];
  /** Contatos do sistema (origens conhecidas) que nenhuma pessoa do plano reivindicou. */
  contatosForaDoPlano: string[];
  resumo: {
    contatosNovos: number;
    contatosAtualizados: number;
    cardsNovos: number;
    cardsMovidos: number;
    cardsAtualizados: number;
    cardsAbsorvidos: number;
    semContato: number;
    foraDoPlanoRevisados: number;
  };
}

/** Mesmas expressões dos CHECK `contacts_email_format` e `contacts_phone_e164_format`. */
const EMAIL_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/i;
const TELEFONE_VALIDO = /^\+\d{8,15}$/;

const unica = (v: readonly string[]): string[] => [...new Set(v)];
const iguais = (a: unknown, b: unknown): boolean => JSON.stringify(ordenar(a)) === JSON.stringify(ordenar(b));

function ordenar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(ordenar);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([k, val]) => [k, ordenar(val)]),
    );
  }
  return v;
}

function financeiroDe(e: LegacyImportEntity): Record<string, unknown> {
  return {
    fonte: "stripe+billing-v2",
    estado: e.bucket,
    assinaturas: e.subscriptions,
    assinaturas_ativas: e.subscriptions.filter((s) => s.status === "active").length,
    cancelamento_agendado: e.cancelAtPeriodEnd,
  };
}

function legadoDe(e: LegacyImportEntity, invalido?: { email?: string; telefone?: string }): Record<string, unknown> {
  return {
    ...(invalido && (invalido.email || invalido.telefone) ? { contato_invalido: invalido } : {}),
    entity_id: e.id,
    user_ids: e.legacyUserIds,
    lead_ids: e.legacyLeadIds,
    stages: e.legacyStages,
    funnels: e.legacyFunnels,
    plan_statuses: e.legacyPlanStatuses,
  };
}

function nomeDe(e: LegacyImportEntity): string {
  return e.name ?? e.email ?? e.phone ?? "Sem nome (importação)";
}

/** Quem tem o quê, em memória, para achar a MESMA pessoa por qualquer identidade. */
function indexarContatos(contatos: ContatoDoBanco[]) {
  const porEntidade = new Map<string, string>();
  const porEmail = new Map<string, string>();
  const porTelefone = new Map<string, string>();
  const porIdDePagamento = new Map<string, string>();
  for (const c of contatos) {
    const legado = (c.custom_fields?.legacy ?? {}) as { entity_id?: unknown };
    if (typeof legado.entity_id === "string") porEntidade.set(legado.entity_id, c.id);
    if (c.email_normalized) porEmail.set(c.email_normalized, c.id);
    if (c.phone_number) porTelefone.set(c.phone_number, c.id);
    const fin = (c.custom_fields?.financeiro ?? {}) as { assinaturas?: Array<{ provider?: string; subscriptionId?: string; customerId?: string | null }> };
    for (const a of fin.assinaturas ?? []) {
      if (a.provider && a.subscriptionId) porIdDePagamento.set(`s:${a.provider}:${a.subscriptionId}`, c.id);
      if (a.provider && a.customerId) porIdDePagamento.set(`c:${a.provider}:${a.customerId}`, c.id);
    }
  }
  return { porEntidade, porEmail, porTelefone, porIdDePagamento };
}

export function planejar(
  modo: ModoDePlano,
  entidades: readonly LegacyImportEntity[],
  contatos: readonly ContatoDoBanco[],
  cards: readonly CardDoBanco[],
  destinos: DestinosDoBanco,
  agora: string,
  opcoes: { foraDoPlano?: "reportar" | "revisar" } = {},
): ResultadoDoPlano {
  const ops: Operacao[] = [];
  const conflitos: Conflito[] = [];
  const idx = indexarContatos([...contatos]);
  const contatoPorId = new Map(contatos.map((c) => [c.id, c]));
  const reivindicados = new Set<string>();
  const resumo = { contatosNovos: 0, contatosAtualizados: 0, cardsNovos: 0, cardsMovidos: 0, cardsAtualizados: 0, cardsAbsorvidos: 0, semContato: 0, foraDoPlanoRevisados: 0 };

  // Contato NOVO desta rodada já ocupa e-mail/telefone: duas pessoas do plano não podem cair no mesmo.
  const emailsNovos = new Set<string>();
  const telefonesNovos = new Set<string>();

  for (const e of entidades) {
    // Dado fora do formato que o banco aceita NÃO é descartado nem "consertado": a pessoa
    // entra sem esse meio de contato e o valor original fica em `legacy.contato_invalido`.
    const emailBruto = e.email?.trim().toLowerCase() ?? null;
    const email = emailBruto && EMAIL_VALIDO.test(emailBruto) ? emailBruto : null;
    const telefone = e.phone && TELEFONE_VALIDO.test(e.phone) ? e.phone : null;
    const invalido = {
      ...(emailBruto && !email ? { email: emailBruto } : {}),
      ...(e.phone && !telefone ? { telefone: e.phone } : {}),
    };

    const candidatos = unica(
      [
        idx.porEntidade.get(e.id),
        email ? idx.porEmail.get(email) : undefined,
        telefone ? idx.porTelefone.get(telefone) : undefined,
        ...e.subscriptions.flatMap((s) => [
          idx.porIdDePagamento.get(`s:${s.provider}:${s.subscriptionId}`),
          s.customerId ? idx.porIdDePagamento.get(`c:${s.provider}:${s.customerId}`) : undefined,
        ]),
      ].filter((x): x is string => Boolean(x)),
    );
    if (candidatos.length > 1) {
      conflitos.push({ entityId: e.id, motivo: "contatos_diferentes_para_a_mesma_pessoa", contatoIds: candidatos });
      // ambíguo NÃO é "fora do plano": ninguém mexe nesses contatos até a identidade ser resolvida
      for (const id of candidatos) reivindicados.add(id);
      continue;
    }

    const destinoDef = DESTINO_POR_BUCKET[e.bucket];
    const destino = destinos[destinoDef.funil];
    const etapaEntradaId = destino?.etapas[destinoDef.etapa];
    if (!destino || !etapaEntradaId) {
      throw new Error(`Destino ausente no banco: ${destinoDef.funil}/${destinoDef.etapa}`);
    }

    const semContato = !email && !telefone;
    if (semContato) resumo.semContato++;
    const tagsDaEntidade = [
      ...(modo === "importacao" ? [TAG_IMPORTACAO_LEGADO] : []),
      ...(TAG_POR_BUCKET[e.bucket] && !(modo === "sync" && e.bucket === "lead") ? [TAG_POR_BUCKET[e.bucket]!] : []),
      ...(semContato && modo === "importacao" ? [TAG_REVISAO_SEM_CONTATO] : []),
    ];
    const ativo = e.bucket === "active";

    // ── contato ───────────────────────────────────────────────────────────
    const contatoId: string | null = candidatos[0] ?? null;
    if (!contatoId) {
      if ((email && emailsNovos.has(email)) || (telefone && telefonesNovos.has(telefone))) {
        conflitos.push({ entityId: e.id, motivo: "contatos_diferentes_para_a_mesma_pessoa", contatoIds: [] });
        continue;
      }
      if (email) emailsNovos.add(email);
      if (telefone) telefonesNovos.add(telefone);
      const tags = unica([...tagsDaEntidade]);
      ops.push({
        op: "inserir_contato",
        entityId: e.id,
        valores: {
          name: e.name ?? email ?? null,
          email,
          // `email_normalized` é `generated always as (lower(trim(email)))` —
          // escrevê-la aqui derruba o INSERT inteiro (Postgres recusa valor
          // não-DEFAULT em coluna gerada). O banco calcula sozinho a partir
          // de `email`.
          phone_number: telefone,
          tags: ativo ? unica([...tags, "cliente"]) : tags,
          source: modo === "importacao" ? ORIGEM_IMPORTACAO_LEGADO : "periciaia_billing",
          source_metadata: modo === "importacao" ? { importacao_legado: true } : { periciaia_billing: { origem: "sync" } },
          custom_fields: { ...(modo === "importacao" ? { legacy: legadoDe(e, invalido) } : {}), financeiro: financeiroDe(e) },
          client_recognized_at: ativo ? agora : null,
          client_tag_by_system: ativo ? "added" : null,
        },
      });
      resumo.contatosNovos++;
    } else {
      reivindicados.add(contatoId);
      const atual = contatoPorId.get(contatoId)!;
      const patch: PatchDeContato = {};

      const tagsAlvo = unica([...atual.tags, ...tagsDaEntidade, ...(ativo && !atual.tags.includes("cliente") ? ["cliente"] : [])]);
      if (!iguais([...atual.tags].sort(), [...tagsAlvo].sort())) patch.tags = tagsAlvo;

      const cf: Record<string, unknown> = { ...atual.custom_fields, financeiro: financeiroDe(e) };
      if (modo === "importacao") cf.legacy = legadoDe(e, invalido);
      if (!iguais(atual.custom_fields, cf)) patch.custom_fields = cf;

      if (modo === "importacao" && atual.source_metadata?.importacao_legado !== true) {
        patch.source_metadata = { ...atual.source_metadata, importacao_legado: true };
      }
      // `client_recognized_at` / `client_tag_by_system` são colunas "do sistema": o
      // banco recusa (42501) escrita vinda de sessão com identidade — o cliente
      // admin do sincronizador entra nessa conta. Só a importação, com a conexão
      // do dono do banco, as escreve; o sync as grava apenas na inserção.
      if (ativo && modo === "importacao") {
        if (!atual.client_recognized_at) patch.client_recognized_at = agora;
        if (!atual.tags.includes("cliente") && atual.client_tag_by_system === null) patch.client_tag_by_system = "added";
      }
      // completa o que falta (só se ninguém mais já usa) — nunca troca o que existe
      if (!atual.email_normalized && email && !idx.porEmail.has(email) && !emailsNovos.has(email)) {
        // Mesma razão do insert acima: `email_normalized` é coluna gerada,
        // nunca escrita direto — o UPDATE a derivaria errado (`"column
        // email_normalized can only be updated to DEFAULT"`).
        patch.email = email;
        emailsNovos.add(email);
      }
      if (!atual.phone_number && telefone && !idx.porTelefone.has(telefone) && !telefonesNovos.has(telefone)) {
        patch.phone_number = telefone;
        telefonesNovos.add(telefone);
      }
      if (Object.keys(patch).length) {
        ops.push({ op: "atualizar_contato", entityId: e.id, contatoId, patch });
        resumo.contatosAtualizados++;
      }
    }

    // ── card ──────────────────────────────────────────────────────────────
    const meusCards = contatoId
      ? cards
          .filter((c) => c.contact_id === contatoId && (ORIGENS_DE_CARD_DO_SISTEMA as readonly string[]).includes(c.source))
          .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      : [];

    const tagsDoCard = modo === "importacao" ? [TAG_IMPORTACAO_LEGADO] : [];
    const metaDoCard = modo === "importacao" ? { importacao_legado: true, legacy_entity_id: e.id, estado: e.bucket } : {};

    if (meusCards.length === 0) {
      ops.push({
        op: "inserir_card",
        entityId: e.id,
        contatoId,
        pipelineId: destino.pipelineId,
        stageId: etapaEntradaId,
        valores: {
          title: nomeDe(e),
          source: modo === "importacao" ? ORIGEM_IMPORTACAO_LEGADO : "periciaia_billing",
          external_id: modo === "importacao" ? `legacy:${e.id}` : `pessoa:${e.id}`,
          source_metadata: metaDoCard,
          tags: tagsDoCard,
        },
      });
      resumo.cardsNovos++;
      continue;
    }

    const [principal, ...extras] = meusCards;
    const noFunilCerto = principal!.pipeline_id === destino.pipelineId;
    const precisaReentrar = noFunilCerto && REENTRADA[e.bucket].includes(principal!.stage_slug);

    if (!noFunilCerto || precisaReentrar) {
      ops.push({
        op: "mover_card",
        entityId: e.id,
        cardId: principal!.id,
        pipelineId: destino.pipelineId,
        stageId: etapaEntradaId,
        source_metadata: {
          ...principal!.source_metadata,
          ...metaDoCard,
          reclassificado_de: { etapa: principal!.stage_slug, status: principal!.status },
        },
        tags: unica([...principal!.tags, ...tagsDoCard]),
      });
      resumo.cardsMovidos++;
    } else if (modo === "importacao") {
      const meta = { ...principal!.source_metadata, ...metaDoCard };
      const tags = unica([...principal!.tags, ...tagsDoCard]);
      if (!iguais(principal!.source_metadata, meta) || !iguais([...principal!.tags].sort(), [...tags].sort())) {
        ops.push({ op: "atualizar_card", entityId: e.id, cardId: principal!.id, source_metadata: meta, tags });
        resumo.cardsAtualizados++;
      }
    }

    for (const extra of extras) {
      ops.push({
        op: "absorver_card",
        entityId: e.id,
        cardId: extra.id,
        nocardId: principal!.id,
        absorvido: {
          source: extra.source,
          external_id: extra.external_id,
          etapa: extra.stage_slug,
          status: extra.status,
          value_cents: extra.value_cents,
        },
      });
      resumo.cardsAbsorvidos++;
    }
  }

  const naoReivindicados = contatos.filter(
    (c) => (ORIGENS_DE_CARD_DO_SISTEMA as readonly string[]).includes(c.source) && !reivindicados.has(c.id) && !c.tags.includes(TAG_REVISAO_BILLING),
  );

  // Sem evidência viva (Stripe/AbacatePay/manual) nem legado: não é cliente ativo e não dá para
  // afirmar que cancelou. Mantém o contato (com marca de revisão e SEM campanha), tira o card de
  // Vendas para a etapa aberta de recuperação e registra o motivo. Nada é apagado.
  if (opcoes.foraDoPlano === "revisar" && naoReivindicados.length) {
    const destino = destinos.retention;
    const etapaId = destino?.etapas[DESTINO_POR_BUCKET.canceled.etapa];
    if (!destino || !etapaId) throw new Error("Destino ausente no banco: retention/cancelados_para_recuperar");
    for (const c of naoReivindicados) {
      const entityId = `fora:${c.id}`;
      ops.push({
        op: "atualizar_contato",
        entityId,
        contatoId: c.id,
        patch: {
          tags: unica([...c.tags, TAG_IMPORTACAO_LEGADO, TAG_REVISAO_BILLING, "ex-cliente"]),
          source_metadata: { ...c.source_metadata, importacao_legado: true },
          custom_fields: {
            ...c.custom_fields,
            financeiro: { fonte: "stripe+billing-v2", estado: "sem_evidencia", assinaturas: [], assinaturas_ativas: 0, cancelamento_agendado: false },
          },
        },
      });
      const meus = cards
        .filter((k) => k.contact_id === c.id && (ORIGENS_DE_CARD_DO_SISTEMA as readonly string[]).includes(k.source))
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
      const [principal, ...extras] = meus;
      if (principal && principal.pipeline_id !== destino.pipelineId) {
        ops.push({
          op: "mover_card",
          entityId,
          cardId: principal.id,
          pipelineId: destino.pipelineId,
          stageId: etapaId,
          source_metadata: {
            ...principal.source_metadata,
            sem_evidencia_no_billing_vivo: true,
            reclassificado_de: { etapa: principal.stage_slug, status: principal.status },
          },
          tags: unica([...principal.tags, TAG_IMPORTACAO_LEGADO]),
        });
        resumo.cardsMovidos++;
      }
      for (const extra of extras) {
        ops.push({
          op: "absorver_card",
          entityId,
          cardId: extra.id,
          nocardId: principal!.id,
          absorvido: { source: extra.source, external_id: extra.external_id, etapa: extra.stage_slug, status: extra.status, value_cents: extra.value_cents },
        });
        resumo.cardsAbsorvidos++;
      }
      resumo.contatosAtualizados++;
      resumo.foraDoPlanoRevisados++;
    }
  }

  const contatosForaDoPlano = opcoes.foraDoPlano === "revisar" ? [] : naoReivindicados.map((c) => c.id);

  return { ops, conflitos, contatosForaDoPlano, resumo };
}
