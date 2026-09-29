/**
 * Importação histórica do CRM antigo do PeríciaIA (Firebase) para o CRM novo (Neon).
 *
 *   tsx --env-file=.env --env-file=.env.local scripts/neon/importar-crm-legado.ts --plano=/caminho/plano.json
 *   ...  --aplicar            grava de verdade (sem isto é SIMULAÇÃO: executa tudo e desfaz)
 *
 * O plano (`{ summary, entities }`) vem de `buildLegacyImportPlan` e é entregue por
 * arquivo (0600) — as credenciais do Stripe/billing só existem no runtime de produção.
 *
 * Tudo acontece em UMA transação com a conexão do dono do banco (MIGRATIONS_DATABASE_URL):
 * carrega o estado, planeja (`legacy-apply.ts`, puro), executa, REPLANEJA para provar
 * idempotência, mede os invariantes no próprio banco e só então commita. Qualquer
 * invariante que não feche desfaz tudo (exit 2). Importar é mover dados e classificação:
 * nada aqui envia mensagem, e todo contato importado carrega as marcas de
 * `lib/leads/importacao-legado.ts`.
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import pg from "pg";

import {
  chaveDeEtapa,
  ORIGENS_DE_CARD_DO_SISTEMA,
  planejar,
  type CardDoBanco,
  type ContatoDoBanco,
  type DestinosDoBanco,
  type Operacao,
} from "@/lib/billing-export/legacy-apply";
import type { LegacyImportEntity } from "@/lib/billing-export/legacy-import";

const { Client } = pg;

function argumento(nome: string): string | null {
  const prefixo = `--${nome}=`;
  const achado = process.argv.find((a) => a.startsWith(prefixo));
  return achado ? achado.slice(prefixo.length) : null;
}
const flag = (nome: string) => process.argv.includes(`--${nome}`);

interface Plano {
  summary: Record<string, number>;
  entities: LegacyImportEntity[];
}

type Db = InstanceType<typeof Client>;

async function contar(db: Db, sql: string, params: unknown[]): Promise<number | null> {
  await db.query("savepoint c");
  try {
    const r = await db.query<{ n: string }>(sql, params);
    await db.query("release savepoint c");
    return Number(r.rows[0]?.n ?? 0);
  } catch {
    await db.query("rollback to savepoint c");
    return null; // tabela ausente nesta versão do schema
  }
}

/** Contadores que precisam ficar IGUAIS antes e depois: nada pode ter sido enviado nem enfileirado. */
async function contadoresDeEnvio(db: Db, org: string): Promise<Record<string, number | null>> {
  return {
    mensagens_saida: await contar(db, "select count(*) n from public.messages where organization_id=$1 and direction='outbound'", [org]),
    send_ledger: await contar(db, "select count(*) n from public.send_ledger where organization_id=$1", [org]),
    outbound_copies: await contar(db, "select count(*) n from public.outbound_copies where organization_id=$1", [org]),
    pacing_ledger: await contar(db, "select count(*) n from public.pacing_ledger where organization_id=$1", [org]),
    followup_enrollments: await contar(db, "select count(*) n from public.followup_enrollments where organization_id=$1", [org]),
    automation_rule_runs: await contar(db, "select count(*) n from public.automation_rule_runs where organization_id=$1", [org]),
    job_queue: await contar(db, "select count(*) n from public.job_queue where organization_id=$1", [org]),
  };
}

async function carregarEstado(db: Db, org: string) {
  const funis = await db.query<{ id: string; kind: string | null }>(
    "select id, settings->>'operational_kind' kind from public.crm_pipelines where organization_id=$1 and is_archived=false",
    [org],
  );
  const etapasBrutas = await db.query<{ id: string; pipeline_id: string; name: string }>(
    "select id, pipeline_id, name from public.crm_stages where organization_id=$1 and is_archived=false",
    [org],
  );
  // Chave pelo NOME, nunca pelo slug: ver `chaveDeEtapa`.
  const etapas = { rows: etapasBrutas.rows.map((e) => ({ id: e.id, pipeline_id: e.pipeline_id, slug: chaveDeEtapa(e.name) })) };
  const slugPorEtapa = new Map(etapas.rows.map((e) => [e.id, e.slug]));
  const destinos: DestinosDoBanco = {};
  for (const f of funis.rows) {
    if (!f.kind) continue;
    destinos[f.kind] = {
      pipelineId: f.id,
      etapas: Object.fromEntries(etapas.rows.filter((e) => e.pipeline_id === f.id).map((e) => [e.slug, e.id])),
    };
  }
  const contatos = (
    await db.query<ContatoDoBanco>(
      `select id, email_normalized, phone_number, coalesce(tags,'{}') tags, source, source_metadata, custom_fields,
              client_recognized_at::text client_recognized_at, client_tag_by_system
         from public.contacts where organization_id=$1 and is_merged_into is null`,
      [org],
    )
  ).rows;
  const cards = (
    await db.query<Omit<CardDoBanco, "stage_slug">>(
      `select id, contact_id, pipeline_id, stage_id, status, created_at::text created_at, source, external_id,
              source_metadata, coalesce(tags,'{}') tags, value_cents::float8 value_cents
         from public.crm_leads where organization_id=$1 and source = any($2::text[])`,
      [org, [...ORIGENS_DE_CARD_DO_SISTEMA]],
    )
  ).rows.map((c) => ({ ...c, stage_slug: slugPorEtapa.get(c.stage_id) ?? "" }));
  return { destinos, contatos, cards, slugPorEtapa };
}

async function executar(db: Db, org: string, ops: Operacao[]) {
  const contatoDeEntidade = new Map<string, string>();
  const proximaPosicao = new Map<string, number>();
  const posicao = async (stageId: string) => {
    if (!proximaPosicao.has(stageId)) {
      const r = await db.query<{ m: string }>("select coalesce(max(position_in_stage),0) m from public.crm_leads where stage_id=$1", [stageId]);
      proximaPosicao.set(stageId, Number(r.rows[0]!.m));
    }
    const p = proximaPosicao.get(stageId)! + 1000;
    proximaPosicao.set(stageId, p);
    return p;
  };

  for (const op of ops) {
    if (op.op === "inserir_contato") {
      const v = op.valores;
      const r = await db.query<{ id: string }>(
        `insert into public.contacts
           (organization_id,name,email,phone_number,tags,source,source_metadata,custom_fields,client_recognized_at,client_tag_by_system)
         values ($1,$2,$3,$4,$5::text[],$6,$7::jsonb,$8::jsonb,$9,$10) returning id`,
        // `email_normalized` é coluna GERADA pelo banco a partir de `email`: não se escreve.
        [org, v.name, v.email, v.phone_number, v.tags, v.source, JSON.stringify(v.source_metadata), JSON.stringify(v.custom_fields), v.client_recognized_at, v.client_tag_by_system],
      );
      contatoDeEntidade.set(op.entityId, r.rows[0]!.id);
    } else if (op.op === "atualizar_contato") {
      const sets: string[] = [];
      const params: unknown[] = [org, op.contatoId];
      const colocar = (col: string, val: unknown, cast = "") => { params.push(val); sets.push(`${col}=$${params.length}${cast}`); };
      const p = op.patch;
      if (p.tags) colocar("tags", p.tags, "::text[]");
      if (p.source_metadata) colocar("source_metadata", JSON.stringify(p.source_metadata), "::jsonb");
      if (p.custom_fields) colocar("custom_fields", JSON.stringify(p.custom_fields), "::jsonb");
      if (p.client_recognized_at) colocar("client_recognized_at", p.client_recognized_at);
      if (p.client_tag_by_system) colocar("client_tag_by_system", p.client_tag_by_system);
      if (p.email) colocar("email", p.email);
      if (p.phone_number) colocar("phone_number", p.phone_number);
      await db.query(`update public.contacts set ${sets.join(", ")} where organization_id=$1 and id=$2`, params);
    } else if (op.op === "inserir_card") {
      const contactId = op.contatoId ?? contatoDeEntidade.get(op.entityId);
      if (!contactId) throw new Error(`contato do card não resolvido (${op.entityId})`);
      const v = op.valores;
      await db.query(
        `insert into public.crm_leads
           (organization_id,pipeline_id,stage_id,contact_id,title,status,position_in_stage,source,source_metadata,external_id,tags)
         values ($1,$2,$3,$4,$5,'open',$6,$7,$8::jsonb,$9,$10::text[])`,
        [org, op.pipelineId, op.stageId, contactId, v.title, await posicao(op.stageId), v.source, JSON.stringify(v.source_metadata), v.external_id, v.tags],
      );
    } else if (op.op === "mover_card") {
      await db.query(
        `update public.crm_leads
            set pipeline_id=$3, stage_id=$4, lost_reason=null, position_in_stage=$5, source_metadata=$6::jsonb, tags=$7::text[]
          where organization_id=$1 and id=$2`,
        [org, op.cardId, op.pipelineId, op.stageId, await posicao(op.stageId), JSON.stringify(op.source_metadata), op.tags],
      );
    } else if (op.op === "atualizar_card") {
      await db.query("update public.crm_leads set source_metadata=$3::jsonb, tags=$4::text[] where organization_id=$1 and id=$2", [
        org, op.cardId, JSON.stringify(op.source_metadata), op.tags,
      ]);
    } else {
      // absorver: o principal guarda o que o duplicado carregava; só depois o duplicado sai.
      await db.query(
        `update public.crm_leads
            set source_metadata = jsonb_set(coalesce(source_metadata,'{}'::jsonb), '{absorvidos}',
                  coalesce(source_metadata->'absorvidos','[]'::jsonb) || $3::jsonb)
          where organization_id=$1 and id=$2`,
        [org, op.nocardId, JSON.stringify([op.absorvido])],
      );
      await db.query("delete from public.crm_leads where organization_id=$1 and id=$2", [org, op.cardId]);
    }
  }
}

interface Invariante { nome: string; esperado: unknown; obtido: unknown; ok: boolean }

async function main() {
  const conexao = process.env.MIGRATIONS_DATABASE_URL;
  if (!conexao) throw new Error("MIGRATIONS_DATABASE_URL ausente");
  const arquivoPlano = argumento("plano");
  if (!arquivoPlano) throw new Error("Informe --plano=/caminho/plano.json");
  const aplicar = flag("aplicar");
  const orgSlug = argumento("org") ?? "periciaia";
  const pastaBackup = argumento("backup-dir") ?? "/root/backups";

  const plano = JSON.parse(readFileSync(arquivoPlano, "utf8")) as Plano;
  if (!Array.isArray(plano.entities) || !plano.summary) throw new Error("Plano inválido (esperado { summary, entities }).");

  const db = new Client({ connectionString: conexao });
  await db.connect();
  let fim: "commit" | "rollback" = "rollback";
  let codigo = 0;
  try {
    await db.query("begin");
    await db.query("set local statement_timeout = '120s'");
    await db.query("select pg_advisory_xact_lock(hashtext('importar-crm-legado'))");

    const org = (await db.query<{ id: string }>("select id from public.organizations where slug=$1", [orgSlug])).rows[0]?.id;
    if (!org) throw new Error(`Organização não encontrada: ${orgSlug}`);

    const antesEnvio = await contadoresDeEnvio(db, org);
    // contatos já marcados como "sem evidência" em rodadas anteriores (a régua é medida no banco, não na rodada)
    const revisadosAntes = Number((await db.query<{ n: string }>(
      "select count(*)::int n from public.contacts where organization_id=$1 and 'revisao_billing' = any(tags) and 'importacao_legado' = any(tags)", [org],
    )).rows[0]!.n);
    const estado = await carregarEstado(db, org);
    const agora = new Date().toISOString();
    const p1 = planejar("importacao", plano.entities, estado.contatos, estado.cards, estado.destinos, agora, { foraDoPlano: "revisar" });

    console.info(JSON.stringify({ fase: "plano", entidades: plano.entities.length, resumo: p1.resumo, conflitos: p1.conflitos.length, contatosForaDoPlano: p1.contatosForaDoPlano.length, operacoes: p1.ops.length }));
    if (p1.conflitos.length || p1.contatosForaDoPlano.length) {
      console.error(JSON.stringify({ abortado: "identidades ambíguas ou contatos do sistema fora do plano", conflitos: p1.conflitos, foraDoPlano: p1.contatosForaDoPlano }));
      codigo = 2;
      return;
    }

    if (aplicar) {
      const [todosContatos, todosCards] = await Promise.all([
        db.query("select * from public.contacts where organization_id=$1", [org]),
        db.query("select * from public.crm_leads where organization_id=$1", [org]),
      ]);
      mkdirSync(pastaBackup, { recursive: true });
      const arq = join(pastaBackup, `importacao-legado-antes-${agora.replace(/[:.]/g, "-")}.json`);
      writeFileSync(arq, JSON.stringify({ org, geradoEm: agora, contacts: todosContatos.rows, crm_leads: todosCards.rows }), { mode: 0o600 });
      chmodSync(arq, 0o600);
      console.info(JSON.stringify({ fase: "backup", arquivo: arq, contatos: todosContatos.rowCount, cards: todosCards.rowCount }));
    }

    await executar(db, org, p1.ops);

    // ── prova de idempotência: replaneja sobre o estado JÁ escrito ─────────────
    const depois = await carregarEstado(db, org);
    const p2 = planejar("importacao", plano.entities, depois.contatos, depois.cards, depois.destinos, agora, { foraDoPlano: "revisar" });

    // ── invariantes medidos no banco ──────────────────────────────────────────
    const porBucket = (b: string) => plano.entities.filter((e) => e.bucket === b).length;
    const ativos = porBucket("active");
    const assinaturasAtivasPlano = plano.entities.reduce((n, e) => n + e.subscriptions.filter((s) => s.status === "active").length, 0);
    const entidadeIds = plano.entities.map((e) => e.id);

    const q = async <T,>(sql: string, params: unknown[]) => (await db.query<T & Record<string, unknown>>(sql, params)).rows;
    const etapaCount = async (kind: string, slug: string) => {
      const r = await q<{ n: string }>(
        `select count(*)::int n from public.crm_leads l
           join public.crm_stages s on s.id=l.stage_id
           join public.crm_pipelines p on p.id=l.pipeline_id
          where l.organization_id=$1 and p.settings->>'operational_kind'=$2
            and regexp_replace(lower(translate(s.name,'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc')),'[^a-z0-9]+','_','g')=$3
            and l.source = any($4::text[])`,
        [org, kind, slug, [...ORIGENS_DE_CARD_DO_SISTEMA]],
      );
      return Number(r[0]!.n);
    };
    const contatosDaImportacao = Number((await q<{ n: string }>(
      "select count(*)::int n from public.contacts where organization_id=$1 and custom_fields->'legacy'->>'entity_id' = any($2::text[])",
      [org, entidadeIds],
    ))[0]!.n);
    const contatosMarcados = Number((await q<{ n: string }>(
      "select count(*)::int n from public.contacts where organization_id=$1 and custom_fields->'legacy'->>'entity_id' = any($2::text[]) and 'importacao_legado' = any(tags)",
      [org, entidadeIds],
    ))[0]!.n);
    const semContatoMarcados = Number((await q<{ n: string }>(
      "select count(*)::int n from public.contacts where organization_id=$1 and 'revisao_sem_contato' = any(tags)", [org],
    ))[0]!.n);
    const duplicados = Number((await q<{ n: string }>(
      `select count(*)::int n from (
         select email_normalized k from public.contacts where organization_id=$1 and is_merged_into is null and email_normalized is not null group by 1 having count(*)>1
         union all
         select phone_number from public.contacts where organization_id=$1 and is_merged_into is null and phone_number is not null group by 1 having count(*)>1
         union all
         select custom_fields->'legacy'->>'entity_id' from public.contacts where organization_id=$1 and custom_fields->'legacy'->>'entity_id' is not null group by 1 having count(*)>1
       ) d`, [org],
    ))[0]!.n);
    const cardsDoSistema = Number((await q<{ n: string }>(
      "select count(*)::int n from public.crm_leads where organization_id=$1 and source = any($2::text[])", [org, [...ORIGENS_DE_CARD_DO_SISTEMA]],
    ))[0]!.n);
    const maxCardsPorContato = Number((await q<{ m: string }>(
      "select coalesce(max(n),0)::int m from (select count(*) n from public.crm_leads where organization_id=$1 and source = any($2::text[]) group by contact_id) z", [org, [...ORIGENS_DE_CARD_DO_SISTEMA]],
    ))[0]!.m);
    const poluemVendas = Number((await q<{ n: string }>(
      `select count(*)::int n from public.crm_leads l join public.crm_stages s on s.id=l.stage_id join public.crm_pipelines p on p.id=l.pipeline_id
        where l.organization_id=$1 and p.settings->>'operational_kind'='sales' and (s.is_won or s.is_lost) and l.source like 'periciaia_billing%'`, [org],
    ))[0]!.n);
    const ativasNoBanco = Number((await q<{ n: string }>(
      `select count(*)::int n from public.contacts c, jsonb_array_elements(coalesce(c.custom_fields->'financeiro'->'assinaturas','[]'::jsonb)) a
        where c.organization_id=$1 and c.custom_fields->'legacy'->>'entity_id' = any($2::text[]) and a->>'status'='active'`, [org, entidadeIds],
    ))[0]!.n);
    const pessoasAtivasNoBanco = Number((await q<{ n: string }>(
      "select count(*)::int n from public.contacts where organization_id=$1 and custom_fields->'legacy'->>'entity_id' = any($2::text[]) and custom_fields->'financeiro'->>'estado'='active'", [org, entidadeIds],
    ))[0]!.n);
    const reconhecidos = Number((await q<{ n: string }>(
      "select count(*)::int n from public.contacts where organization_id=$1 and custom_fields->'legacy'->>'entity_id' = any($2::text[]) and custom_fields->'financeiro'->>'estado'='active' and client_recognized_at is not null", [org, entidadeIds],
    ))[0]!.n);
    const depoisEnvio = await contadoresDeEnvio(db, org);

    const inv: Invariante[] = [];
    const ver = (nome: string, esperado: unknown, obtido: unknown) => inv.push({ nome, esperado, obtido, ok: JSON.stringify(esperado) === JSON.stringify(obtido) });
    ver("pessoas únicas no plano", plano.summary.uniquePeople ?? plano.entities.length, plano.entities.length);
    ver("cada pessoa = 1 contato (com id legado)", plano.entities.length, contatosDaImportacao);
    ver("todo contato importado carrega a trava importacao_legado", plano.entities.length, contatosMarcados);
    ver("contatos revisao_sem_contato (sem e-mail e sem telefone)", plano.summary.groupsWithoutEmailOrPhone ?? plano.entities.filter((e) => !e.email && !e.phone).length, semContatoMarcados);
    const revisadosMarcados = Number((await q<{ n: string }>(
      "select count(*)::int n from public.contacts where organization_id=$1 and 'revisao_billing' = any(tags) and 'importacao_legado' = any(tags)", [org],
    ))[0]!.n);
    const revisadosEsperados = revisadosAntes + p1.resumo.foraDoPlanoRevisados;
    ver("contatos sem evidência no billing vivo: marcados (revisao_billing + trava)", revisadosEsperados, revisadosMarcados);
    ver("contatos duplicados (e-mail, telefone ou id legado)", 0, duplicados);
    ver("Pós-vendas / Cliente ativo", ativos, await etapaCount("post_sales", "cliente_ativo"));
    ver("Vendas / Primeiro contato", porBucket("lead"), await etapaCount("sales", "primeiro_contato"));
    ver("Retenção / Cancelados para recuperar (cancelados do billing + sem evidência)", porBucket("canceled") + revisadosEsperados, await etapaCount("retention", "cancelados_para_recuperar"));
    ver("Retenção / Vencido", porBucket("past_due"), await etapaCount("retention", "vencido"));
    ver("1 card do sistema por pessoa (total, incl. sem evidência)", plano.entities.length + revisadosEsperados, cardsDoSistema);
    ver("máximo de cards do sistema por contato", 1, maxCardsPorContato);
    ver("cards billing won/lost poluindo Vendas", 0, poluemVendas);
    ver("clientes ativos únicos", ativos, pessoasAtivasNoBanco);
    ver("clientes ativos reconhecidos (client_recognized_at)", ativos, reconhecidos);
    ver("assinaturas ativas preservadas", assinaturasAtivasPlano, ativasNoBanco);
    if (plano.summary.currentBillingActiveEvidence !== undefined) {
      ver("assinaturas ativas = evidência do billing vivo", plano.summary.currentBillingActiveEvidence, ativasNoBanco);
    }
    // contador que não pôde ser lido (tabela ausente) NÃO conta como "zero": reprova.
    ver("todos os contadores de envio puderam ser medidos", [], Object.entries({ ...antesEnvio, ...depoisEnvio }).filter(([, v]) => v === null).map(([k]) => k));
    ver("zero envio/fila criados (mensagens, ledgers, follow-up, automações, jobs)", antesEnvio, depoisEnvio);
    ver("idempotência: 2º planejamento sobre o estado escrito", 0, p2.ops.length);
    ver("sem conflitos no 2º planejamento", 0, p2.conflitos.length);

    console.info(JSON.stringify({ fase: "invariantes", todosOk: inv.every((i) => i.ok), invariantes: inv }, null, 2));
    if (!inv.every((i) => i.ok)) { codigo = 2; return; }

    if (aplicar) { fim = "commit"; console.info(JSON.stringify({ fase: "resultado", gravado: true })); }
    else console.info(JSON.stringify({ fase: "resultado", gravado: false, nota: "SIMULAÇÃO: tudo executado e desfeito (rollback)" }));
  } catch (erro) {
    console.error(erro instanceof Error ? erro.message : erro);
    codigo = 1;
  } finally {
    await db.query(fim).catch(() => undefined);
    await db.end();
    process.exit(codigo);
  }
}

void main();
