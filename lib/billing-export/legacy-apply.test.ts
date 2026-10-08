import { describe, expect, it } from "vitest";

import { FUNIS_OPERACIONAIS } from "@/lib/pipelines/funis-operacionais";
import {
  chaveDeEtapa,
  DESTINO_POR_BUCKET,
  planejar,
  REENTRADA,
  type CardDoBanco,
  type ContatoDoBanco,
  type DestinosDoBanco,
  type ModoDePlano,
  type Operacao,
} from "./legacy-apply";
import type { LegacyImportEntity } from "./legacy-import";

const AGORA = "2026-09-29T15:00:00.000Z";

const DESTINOS: DestinosDoBanco = {
  sales: { pipelineId: "P-V", etapas: { primeiro_contato: "S-pc", perdido: "S-perd", assinante_ativo: "S-ass", qualificado: "S-q" } },
  post_sales: { pipelineId: "P-P", etapas: { cliente_ativo: "S-ca", acompanhamento: "S-ac", encerrado: "S-enc" } },
  retention: {
    pipelineId: "P-R",
    etapas: { vencido: "S-venc", cancelados_para_recuperar: "S-canc", regularizado: "S-reg", negociacao_promessa: "S-neg" },
  },
};
const SLUG_DA_ETAPA: Record<string, string> = {};
const PIPE_DA_ETAPA: Record<string, string> = {};
for (const d of Object.values(DESTINOS)) {
  for (const [slug, id] of Object.entries(d!.etapas)) { SLUG_DA_ETAPA[id] = slug; PIPE_DA_ETAPA[id] = d!.pipelineId; }
}

function entidade(p: Partial<LegacyImportEntity> & { id: string }): LegacyImportEntity {
  return {
    bucket: "lead", name: "Fulano", email: null, phone: null, cancelAtPeriodEnd: false,
    legacyUserIds: [], legacyLeadIds: [], legacyStages: [], legacyFunnels: [], legacyPlanStatuses: [],
    paymentProviders: [], paymentCustomerIds: [], paymentSubscriptionIds: [], subscriptions: [],
    sourceRecordCount: 1, identityKeys: [], ...p,
  };
}
const ass = (id: string, status: "active" | "canceled" | "past_due", provider = "stripe") =>
  ({
    provider,
    subscriptionId: id,
    customerId: `cus_${id}`,
    status,
    cancelAtPeriodEnd: false,
    mrrCents: status === "canceled" ? 0 : 9990,
  }) as const;

function contato(p: Partial<ContatoDoBanco> & { id: string }): ContatoDoBanco {
  return {
    email_normalized: null, phone_number: null, tags: [], source: "periciaia_billing", source_metadata: {},
    custom_fields: {}, client_recognized_at: null, client_tag_by_system: null, ...p,
  };
}
function card(p: Partial<CardDoBanco> & { id: string; stage_id: string }): CardDoBanco {
  return {
    contact_id: null, pipeline_id: PIPE_DA_ETAPA[p.stage_id]!, stage_slug: SLUG_DA_ETAPA[p.stage_id]!, status: "open",
    created_at: "2026-09-01T00:00:00Z", source: "periciaia_billing", external_id: `x:${p.id}`,
    source_metadata: {}, tags: [], value_cents: null, ...p,
  };
}

// Aplica as operações em memória, como o executor faria, para provar idempotência.
function aplicar(ops: Operacao[], contatos: ContatoDoBanco[], cards: CardDoBanco[], modo: ModoDePlano) {
  const cs = contatos.map((c) => ({ ...c }));
  let cr = cards.map((c) => ({ ...c }));
  const novoPorEntidade = new Map<string, string>();
  let seq = 0;
  for (const op of ops) {
    if (op.op === "inserir_contato") {
      const id = `novo-${++seq}`;
      novoPorEntidade.set(op.entityId, id);
      // `email_normalized` é `generated always as (lower(trim(email)))` no
      // banco real — o produtor não escreve, então o simulador deriva aqui,
      // igual o Postgres faria no INSERT.
      cs.push(
        contato({
          id,
          ...op.valores,
          email_normalized: op.valores.email ? op.valores.email.toLowerCase().trim() : null,
        }),
      );
    } else if (op.op === "atualizar_contato") {
      const c = cs.find((x) => x.id === op.contatoId)!;
      Object.assign(c, op.patch);
      if (op.patch.email) c.email_normalized = op.patch.email.toLowerCase().trim();
    } else if (op.op === "inserir_card") {
      const contactId = op.contatoId ?? novoPorEntidade.get(op.entityId)!;
      cr.push(card({ id: `card-${++seq}`, stage_id: op.stageId, contact_id: contactId, source: op.valores.source, external_id: op.valores.external_id, source_metadata: op.valores.source_metadata, tags: op.valores.tags }));
    } else if (op.op === "mover_card") {
      const c = cr.find((x) => x.id === op.cardId)!;
      Object.assign(c, { stage_id: op.stageId, pipeline_id: op.pipelineId, stage_slug: SLUG_DA_ETAPA[op.stageId], status: "open", source_metadata: op.source_metadata, tags: op.tags });
    } else if (op.op === "atualizar_card") {
      const c = cr.find((x) => x.id === op.cardId)!;
      Object.assign(c, { source_metadata: op.source_metadata, tags: op.tags });
    } else if (op.op === "absorver_card") {
      cr = cr.filter((x) => x.id !== op.cardId);
    }
  }
  void modo;
  return { contatos: cs, cards: cr };
}

describe("chaves de etapa do planejador × modelo operacional de funis", () => {
  const chavesDoModelo = (kind: string) =>
    new Set(FUNIS_OPERACIONAIS.find((f) => f.kind === kind)!.etapas.map((e) => chaveDeEtapa(e.nome)));

  it("todo destino por estado existe no funil certo", () => {
    for (const [bucket, d] of Object.entries(DESTINO_POR_BUCKET)) {
      expect(chavesDoModelo(d.funil), `destino de ${bucket}: ${d.funil}/${d.etapa}`).toContain(d.etapa);
    }
  });

  it("toda etapa de reentrada existe no funil do destino", () => {
    for (const [bucket, chaves] of Object.entries(REENTRADA)) {
      const funil = DESTINO_POR_BUCKET[bucket as keyof typeof DESTINO_POR_BUCKET].funil;
      for (const chave of chaves) expect(chavesDoModelo(funil), `reentrada de ${bucket}: ${funil}/${chave}`).toContain(chave);
    }
  });

  it("a chave nasce do nome, sem acento, e não do slug histórico", () => {
    expect(chaveDeEtapa("Cancelados para recuperar")).toBe("cancelados_para_recuperar");
    expect(chaveDeEtapa("Demonstração agendada")).toBe("demonstracao_agendada");
  });
});

describe("planejar — destinos por estado (importação)", () => {
  it("lead → Vendas/Primeiro contato; ativo → Pós-vendas/Cliente ativo; cancelado → Retenção/Cancelados para recuperar", () => {
    const r = planejar("importacao", [
      entidade({ id: "l1", bucket: "lead", email: "l@x.com" }),
      entidade({ id: "a1", bucket: "active", email: "a@x.com", phone: "+5585999990000", subscriptions: [ass("s1", "active")] }),
      entidade({ id: "c1", bucket: "canceled", email: "c@x.com", subscriptions: [ass("s2", "canceled")] }),
    ], [], [], DESTINOS, AGORA);

    const cards = r.ops.filter((o) => o.op === "inserir_card") as Extract<Operacao, { op: "inserir_card" }>[];
    expect(cards.map((c) => [c.entityId, c.stageId])).toEqual([["l1", "S-pc"], ["a1", "S-ca"], ["c1", "S-canc"]]);
    expect(r.conflitos).toEqual([]);
    expect(r.resumo).toMatchObject({ contatosNovos: 3, cardsNovos: 3, cardsMovidos: 0 });
  });

  it("todo contato importado carrega as marcas de não-disparo; ativo vira cliente reconhecido", () => {
    const r = planejar("importacao", [entidade({ id: "a1", bucket: "active", email: "a@x.com", subscriptions: [ass("s1", "active")] })], [], [], DESTINOS, AGORA);
    const c = r.ops.find((o) => o.op === "inserir_contato") as Extract<Operacao, { op: "inserir_contato" }>;
    expect(c.valores).toMatchObject({ source: "periciaia_legado", source_metadata: { importacao_legado: true }, client_recognized_at: AGORA, client_tag_by_system: "added" });
    expect(c.valores.tags).toEqual(expect.arrayContaining(["importacao_legado", "cliente"]));
    expect(c.valores.custom_fields).toMatchObject({ financeiro: { assinaturas_ativas: 1, estado: "active" }, legacy: { entity_id: "a1" } });
  });

  it("sem e-mail e sem telefone: importa como contato histórico, marca revisao_sem_contato e não fabrica contato", () => {
    const r = planejar("importacao", [entidade({ id: "u:1", bucket: "lead", name: "Sem Meio", legacyUserIds: ["u1"] })], [], [], DESTINOS, AGORA);
    const c = r.ops.find((o) => o.op === "inserir_contato") as Extract<Operacao, { op: "inserir_contato" }>;
    expect(c.valores).toMatchObject({ email: null, phone_number: null });
    expect(c.valores.tags).toEqual(expect.arrayContaining(["importacao_legado", "revisao_sem_contato"]));
    expect(r.resumo.semContato).toBe(1);
  });
});

describe("planejar — dado fora do formato do banco", () => {
  it("e-mail inválido não é gravado nem descarta a pessoa: usa o telefone e guarda o original", () => {
    const r = planejar("importacao", [entidade({ id: "t", bucket: "lead", email: "te@teste", phone: "+5585999990000", legacyUserIds: ["u1"] })], [], [], DESTINOS, AGORA);
    const c = r.ops.find((o) => o.op === "inserir_contato") as Extract<Operacao, { op: "inserir_contato" }>;
    expect(c.valores).toMatchObject({ email: null, phone_number: "+5585999990000" });
    expect(c.valores.tags).not.toContain("revisao_sem_contato");
    expect((c.valores.custom_fields.legacy as { contato_invalido: unknown }).contato_invalido).toEqual({ email: "te@teste" });
  });

  it("e-mail inválido e sem telefone: vira revisao_sem_contato, sem fabricar contato", () => {
    const r = planejar("importacao", [entidade({ id: "t2", bucket: "lead", email: "isso nao e email" })], [], [], DESTINOS, AGORA);
    const c = r.ops.find((o) => o.op === "inserir_contato") as Extract<Operacao, { op: "inserir_contato" }>;
    expect(c.valores).toMatchObject({ email: null, phone_number: null });
    expect(c.valores.tags).toContain("revisao_sem_contato");
  });

  it("telefone fora do formato E.164 também é preservado à parte", () => {
    const r = planejar("importacao", [entidade({ id: "t3", bucket: "lead", email: "ok@x.com", phone: "123" })], [], [], DESTINOS, AGORA);
    const c = r.ops.find((o) => o.op === "inserir_contato") as Extract<Operacao, { op: "inserir_contato" }>;
    expect(c.valores.phone_number).toBeNull();
    expect((c.valores.custom_fields.legacy as { contato_invalido: unknown }).contato_invalido).toEqual({ telefone: "123" });
  });
});

describe("planejar — reaproveita cards do billing sem duplicar", () => {
  it("cards antigos won/lost em Vendas viram Pós-vendas / Retenção; 2 assinaturas ativas = 1 pessoa, 1 card, duplicado absorvido", () => {
    const contatos = [contato({ id: "c-a", email_normalized: "a@x.com" }), contato({ id: "c-c", email_normalized: "c@x.com" })];
    const cards = [
      card({ id: "k1", stage_id: "S-ass", status: "won", contact_id: "c-a", created_at: "2026-09-01T00:00:00Z", value_cents: 5000 }),
      card({ id: "k2", stage_id: "S-ass", status: "won", contact_id: "c-a", created_at: "2026-09-02T00:00:00Z", value_cents: 7000 }),
      card({ id: "k3", stage_id: "S-perd", status: "lost", contact_id: "c-c" }),
    ];
    const r = planejar("importacao", [
      entidade({ id: "a", bucket: "active", email: "a@x.com", subscriptions: [ass("s1", "active"), ass("s2", "active", "abacatepay")] }),
      entidade({ id: "c", bucket: "canceled", email: "c@x.com", subscriptions: [ass("s3", "canceled")] }),
    ], contatos, cards, DESTINOS, AGORA);

    const movidos = r.ops.filter((o) => o.op === "mover_card") as Extract<Operacao, { op: "mover_card" }>[];
    expect(movidos.map((m) => [m.cardId, m.stageId])).toEqual([["k1", "S-ca"], ["k3", "S-canc"]]);
    expect(movidos[0]!.source_metadata).toMatchObject({ reclassificado_de: { etapa: "assinante_ativo", status: "won" } });
    expect(r.ops.filter((o) => o.op === "absorver_card")).toEqual([
      expect.objectContaining({ cardId: "k2", nocardId: "k1", absorvido: expect.objectContaining({ value_cents: 7000 }) }),
    ]);
    expect(r.resumo).toMatchObject({ contatosNovos: 0, cardsNovos: 0, cardsMovidos: 2, cardsAbsorvidos: 1 });
    // as duas assinaturas ativas ficam preservadas nos metadados financeiros do contato
    const upd = r.ops.find((o) => o.op === "atualizar_contato" && o.contatoId === "c-a") as Extract<Operacao, { op: "atualizar_contato" }>;
    expect((upd.patch.custom_fields as { financeiro: { assinaturas_ativas: number } }).financeiro.assinaturas_ativas).toBe(2);
  });

  it("card de outra origem (WhatsApp) nunca é tocado; a pessoa ganha o card do sistema ao lado", () => {
    const contatos = [contato({ id: "c-a", email_normalized: "a@x.com" })];
    const cards = [card({ id: "w1", stage_id: "S-q", contact_id: "c-a", source: "whatsapp" })];
    const r = planejar("importacao", [entidade({ id: "a", bucket: "active", email: "a@x.com", subscriptions: [ass("s1", "active")] })], contatos, cards, DESTINOS, AGORA);
    expect(r.ops.some((o) => (o.op === "mover_card" || o.op === "absorver_card") && o.cardId === "w1")).toBe(false);
    expect(r.resumo.cardsNovos).toBe(1);
  });
});

describe("planejar — não regride o progresso da equipe", () => {
  const um = (bucket: "active" | "past_due" | "canceled", stage: string) => {
    const contatos = [contato({ id: "c", email_normalized: "p@x.com" })];
    const cards = [card({ id: "k", stage_id: stage, contact_id: "c" })];
    return planejar("sync", [entidade({ id: "p", bucket, email: "p@x.com", subscriptions: [ass("s", bucket === "past_due" ? "past_due" : bucket)] })], contatos, cards, DESTINOS, AGORA);
  };
  const moveu = (r: ReturnType<typeof um>) => r.ops.filter((o) => o.op === "mover_card");

  it("ativo que já está em Pós-vendas, em qualquer etapa aberta, fica onde está", () => {
    expect(moveu(um("active", "S-ac"))).toEqual([]);
  });
  it("ativo em etapa terminal 'Encerrado' volta a Cliente ativo", () => {
    expect(moveu(um("active", "S-enc"))).toEqual([expect.objectContaining({ stageId: "S-ca" })]);
  });
  it("cancelado que já negocia retenção fica; regularizado que cancelou volta a Cancelados para recuperar", () => {
    expect(moveu(um("canceled", "S-neg"))).toEqual([]);
    expect(moveu(um("canceled", "S-reg"))).toEqual([expect.objectContaining({ stageId: "S-canc" })]);
  });
  it("vencido: quem estava Regularizado ou Cancelados para recuperar volta a Vencido", () => {
    expect(moveu(um("past_due", "S-reg"))).toEqual([expect.objectContaining({ stageId: "S-venc" })]);
    expect(moveu(um("past_due", "S-canc"))).toEqual([expect.objectContaining({ stageId: "S-venc" })]);
  });
  it("billing nunca põe pagante em Vendas: ativo vindo de Vendas/Assinante ativo sai de lá", () => {
    expect(moveu(um("active", "S-ass"))).toEqual([expect.objectContaining({ pipelineId: "P-P", stageId: "S-ca" })]);
  });
});

describe("planejar — identidade e conflitos", () => {
  it("acha o contato pelo id de assinatura guardado quando o e-mail mudou", () => {
    const contatos = [contato({ id: "c", email_normalized: "velho@x.com", custom_fields: { financeiro: { assinaturas: [{ provider: "stripe", subscriptionId: "s9", customerId: "cus_s9" }] } } })];
    const r = planejar("sync", [entidade({ id: "p", bucket: "active", email: "novo@x.com", subscriptions: [ass("s9", "active")] })], contatos, [], DESTINOS, AGORA);
    expect(r.resumo.contatosNovos).toBe(0);
    expect(r.ops.find((o) => o.op === "inserir_card")).toMatchObject({ contatoId: "c" });
  });

  it("e-mail de um contato e telefone de outro: conflito, nenhuma operação para a pessoa", () => {
    const contatos = [contato({ id: "c1", email_normalized: "p@x.com" }), contato({ id: "c2", phone_number: "+5585999990000" })];
    const r = planejar("importacao", [entidade({ id: "p", bucket: "lead", email: "p@x.com", phone: "+5585999990000" })], contatos, [], DESTINOS, AGORA);
    expect(r.conflitos).toEqual([expect.objectContaining({ entityId: "p", contatoIds: ["c1", "c2"] })]);
    expect(r.ops).toEqual([]);
  });

  it("duas pessoas do plano com o mesmo e-mail não geram dois contatos", () => {
    const r = planejar("importacao", [entidade({ id: "x", email: "d@x.com" }), entidade({ id: "y", email: "d@x.com" })], [], [], DESTINOS, AGORA);
    expect(r.resumo.contatosNovos).toBe(1);
    expect(r.conflitos).toHaveLength(1);
  });

  it("identidade ambígua não vira 'fora do plano': os contatos em conflito ficam intocados", () => {
    const contatos = [contato({ id: "c1", email_normalized: "p@x.com" }), contato({ id: "c2", phone_number: "+5585999990000" })];
    const r = planejar("importacao", [entidade({ id: "p", bucket: "lead", email: "p@x.com", phone: "+5585999990000" })], contatos, [], DESTINOS, AGORA, { foraDoPlano: "revisar" });
    expect(r.conflitos).toHaveLength(1);
    expect(r.ops).toEqual([]);
  });

  it("contato do sistema que nenhuma pessoa reivindicou é reportado, não mexido", () => {
    const r = planejar("importacao", [entidade({ id: "x", email: "a@x.com" })], [contato({ id: "orfao", email_normalized: "z@x.com" })], [], DESTINOS, AGORA);
    expect(r.contatosForaDoPlano).toEqual(["orfao"]);
  });
});

describe("planejar — modo sync", () => {
  it("não aplica marcas de importação nem cria card de lead; contato novo nasce como periciaia_billing", () => {
    const r = planejar("sync", [entidade({ id: "n", bucket: "active", email: "n@x.com", subscriptions: [ass("s", "active")] })], [], [], DESTINOS, AGORA);
    const c = r.ops.find((o) => o.op === "inserir_contato") as Extract<Operacao, { op: "inserir_contato" }>;
    expect(c.valores.source).toBe("periciaia_billing");
    expect(c.valores.tags).not.toContain("importacao_legado");
    const k = r.ops.find((o) => o.op === "inserir_card") as Extract<Operacao, { op: "inserir_card" }>;
    expect(k).toMatchObject({ stageId: "S-ca", valores: { source: "periciaia_billing", tags: [] } });
  });
});

describe("planejar — idempotência (a prova que importa)", () => {
  const entidades: LegacyImportEntity[] = [
    entidade({ id: "l1", bucket: "lead", email: "l@x.com" }),
    entidade({ id: "l2", bucket: "lead", name: "Sem Meio", legacyUserIds: ["u9"] }),
    entidade({ id: "a1", bucket: "active", email: "a@x.com", phone: "+5585999990000", subscriptions: [ass("s1", "active"), ass("s1b", "active", "abacatepay")] }),
    entidade({ id: "c1", bucket: "canceled", email: "c@x.com", subscriptions: [ass("s2", "canceled")] }),
    entidade({ id: "p1", bucket: "past_due", email: "p@x.com", subscriptions: [ass("s3", "past_due")] }),
  ];
  const contatos0 = [contato({ id: "c-a", email_normalized: "a@x.com" }), contato({ id: "c-c", email_normalized: "c@x.com" })];
  const cards0 = [
    card({ id: "k1", stage_id: "S-ass", status: "won", contact_id: "c-a" }),
    card({ id: "k2", stage_id: "S-ass", status: "won", contact_id: "c-a", created_at: "2026-09-03T00:00:00Z" }),
    card({ id: "k3", stage_id: "S-perd", status: "lost", contact_id: "c-c" }),
  ];

  for (const modo of ["importacao", "sync"] as const) {
    it(`${modo}: a 2ª execução não cria, não move e não atualiza nada`, () => {
      const ents = modo === "sync" ? entidades.filter((e) => e.bucket !== "lead") : entidades;
      const p1 = planejar(modo, ents, contatos0, cards0, DESTINOS, AGORA);
      expect(p1.ops.length).toBeGreaterThan(0);
      const depois = aplicar(p1.ops, contatos0, cards0, modo);
      const p2 = planejar(modo, ents, depois.contatos, depois.cards, DESTINOS, "2026-09-30T15:00:00.000Z");
      expect(p2.ops).toEqual([]);
      expect(p2.conflitos).toEqual([]);
      // uma pessoa = um contato = um card do sistema
      expect(new Set(depois.contatos.map((c) => c.email_normalized).filter(Boolean)).size).toBe(depois.contatos.filter((c) => c.email_normalized).length);
      const porContato = new Map<string | null, number>();
      for (const k of depois.cards) porContato.set(k.contact_id, (porContato.get(k.contact_id) ?? 0) + 1);
      expect(Math.max(...porContato.values())).toBe(1);
    });
  }
});

describe("planejar — contato do sistema sem evidência no billing vivo (foraDoPlano: revisar)", () => {
  const contatos = [
    contato({ id: "f1", email_normalized: "fantasma@x.com" }),
    contato({ id: "f2", email_normalized: "ativo-antigo@x.com" }),
  ];
  const cards = [
    card({ id: "kf1", stage_id: "S-perd", status: "lost", contact_id: "f1", value_cents: 9990 }),
    card({ id: "kf2", stage_id: "S-ass", status: "won", contact_id: "f2", value_cents: 1388 }),
  ];
  const plano = () => planejar("importacao", [entidade({ id: "x", bucket: "lead", email: "x@x.com" })], contatos, cards, DESTINOS, AGORA, { foraDoPlano: "revisar" });

  it("mantém o contato (marcado, sem campanha) e tira o card de Vendas para Cancelados para recuperar, sem apagar nada", () => {
    const r = plano();
    expect(r.contatosForaDoPlano).toEqual([]);
    expect(r.resumo.foraDoPlanoRevisados).toBe(2);
    const movidos = r.ops.filter((o) => o.op === "mover_card") as Extract<Operacao, { op: "mover_card" }>[];
    expect(movidos.map((m) => [m.cardId, m.stageId])).toEqual([["kf1", "S-canc"], ["kf2", "S-canc"]]);
    expect(movidos[0]!.source_metadata).toMatchObject({ sem_evidencia_no_billing_vivo: true, reclassificado_de: { etapa: "perdido", status: "lost" } });
    const upd = r.ops.find((o) => o.op === "atualizar_contato" && o.contatoId === "f1") as Extract<Operacao, { op: "atualizar_contato" }>;
    expect(upd.patch.tags).toEqual(expect.arrayContaining(["importacao_legado", "revisao_billing", "ex-cliente"]));
    expect((upd.patch.custom_fields as { financeiro: { estado: string } }).financeiro.estado).toBe("sem_evidencia");
    expect(r.ops.some((o) => o.op === "absorver_card")).toBe(false);
  });

  it("no modo padrão (reportar) só lista, não mexe", () => {
    const r = planejar("importacao", [entidade({ id: "x", bucket: "lead", email: "x@x.com" })], contatos, cards, DESTINOS, AGORA);
    expect(r.contatosForaDoPlano).toEqual(["f1", "f2"]);
    expect(r.ops.some((o) => o.op === "mover_card")).toBe(false);
  });

  it("idempotente: depois de aplicado, não há mais nada a fazer", () => {
    const ents = [entidade({ id: "x", bucket: "lead", email: "x@x.com" })];
    const p1 = planejar("importacao", ents, contatos, cards, DESTINOS, AGORA, { foraDoPlano: "revisar" });
    const depois = aplicar(p1.ops, contatos, cards, "importacao");
    const p2 = planejar("importacao", ents, depois.contatos, depois.cards, DESTINOS, AGORA, { foraDoPlano: "revisar" });
    expect(p2.ops).toEqual([]);
    expect(p2.contatosForaDoPlano).toEqual([]);
  });
});
