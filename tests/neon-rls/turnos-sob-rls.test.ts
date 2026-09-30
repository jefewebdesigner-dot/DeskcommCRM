/**
 * Os handlers REAIS do agent-engine rodando como o worker roda em produção: role restrita, sem
 * BYPASSRLS, contexto de organização por transação (migration Neon 0015) — contra o schema real.
 *
 * O modelo é fake (`createFakeRegistry`) e o canal só captura o envio; todo o resto — banco, fila,
 * ledger, guardas, checkpoint — é o código de produção. Cada teste prova duas coisas: o turno CONCLUI
 * com a RLS ligada (nenhuma consulta escapou do contexto) e NADA vaza para a outra organização.
 *
 *   eval "$(scripts/neon/rls-harness.sh url | sed 's/^/export /')" && pnpm vitest run tests/neon-rls
 */
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { withServiceJob } from '@/lib/atendimento/fronteira-server';
import { createTenantPool, type TenantPool } from '@/lib/agent-engine/db/tenant-pool';
import { createInboundTurnHandler } from '@/lib/agent-engine/agent/inbound-turn';
import { createFakeRegistry } from '@/lib/agent-engine/edge/llm/providers';
import { claimJobs, completeJob, enqueueJob, failJob, type JobRow } from '@/lib/agent-engine/queue/queue';

const DONO = process.env.RLS_DB_DONO;
const APP = process.env.RLS_DB_APP;
const suite = DONO && APP ? describe : describe.skip;

process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://placeholder.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'placeholder-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'placeholder-service';

const SEGREDO = randomBytes(24).toString('hex');
const UID = randomUUID();

interface Cenario {
  org: string;
  contact: string;
  session: string;
  conv: string;
  msg: string;
}
const novo = (): Cenario => ({ org: randomUUID(), contact: randomUUID(), session: randomUUID(), conv: randomUUID(), msg: randomUUID() });
const silencioso = { info: () => undefined, warn: () => undefined, error: () => undefined };
const A = novo();
const B = novo();

let dono: pg.Pool;
let appBase: pg.Pool;
let tenant: TenantPool;
let enviados: Array<{ body: string }> = [];

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const USO = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const CHECKPOINT = JSON.stringify({ commitments: [], objections: [], next_action: null, rolling_summary: 'turno de teste sob RLS' });

/** Modelo fake: manda UMA mensagem e encerra com o checkpoint. */
function modeloQueResponde(texto: string) {
  let chamadas = 0;
  return async () => {
    if (chamadas === 0) {
      chamadas += 1;
      return {
        content: [{ type: 'tool-call' as const, toolCallId: 'c1', toolName: 'send_message', input: JSON.stringify({ body: texto }) }],
        finishReason: { unified: 'tool-calls' as const, raw: undefined },
        usage: USO,
        warnings: [],
      };
    }
    return { content: [{ type: 'text' as const, text: CHECKPOINT }], finishReason: { unified: 'stop' as const, raw: undefined }, usage: USO, warnings: [] };
  };
}

function montaHandler(doGenerate: unknown) {
  return createInboundTurnHandler({
    crmCfg: { supabase: {} as never },
    llmCfg: { anthropicApiKey: 'fake' } as never,
    knobs: {
      historyLimit: 10,
      maxContextTokens: 1000,
      notesIndexMaxTokens: 500,
      maxSteps: 6,
      queuedRetryDelayMs: 1000,
      breaker: { exactFailureWarn: 2, exactFailureBlock: 5, sameToolFailureWarn: 3, sameToolFailureHalt: 8, noProgressWarn: 3, noProgressBlock: 5 },
    },
    log: silencioso,
    registry: createFakeRegistry(doGenerate as never),
    channel: () =>
      ({
        channel: 'captura',
        send: async (i: { body: string }) => {
          enviados.push(i);
          return { kind: 'sent' as const, idempotencyKey: `k${enviados.length}`, messageId: `m${enviados.length}` };
        },
        sessionHealth: async () => ({ healthy: true, status: 'WORKING' }),
        capabilities: () => ({ freeform: true, media: true, audio: true }),
        costPerMessage: () => ({ currency: 'BRL', cents: 0 }),
      }) as never,
    clock: () => new Date('2026-07-28T18:00:00Z'), // terça 15h BRT: dentro da janela anti-ban
    sleep: async () => {},
  });
}

/** O que o worker faz por job: contexto da org do JOB persistido → withServiceJob → handler → complete/fail. */
async function rodaComoOWorker(job: JobRow, handler: ReturnType<typeof montaHandler>): Promise<Error | null> {
  return tenant.withOrganization(job.organization_id, async () => {
    try {
      await withServiceJob(tenant, job, () => handler(job, tenant, { workerId: 'w-rls' }));
      await completeJob(tenant, job.id, 'w-rls', undefined, job.claim_acquired_at);
      return null;
    } catch (err) {
      await failJob(tenant, job.id, 'w-rls', err, job.claim_acquired_at);
      return err as Error;
    }
  });
}

async function enfileiraEClaima(c: Cenario, kind: 'inbound_turn' = 'inbound_turn'): Promise<JobRow> {
  const id = await tenant.withOrganization(c.org, async () => {
    const { job } = await enqueueJob(tenant, c.org, {
      kind,
      leadId: c.contact,
      payload: { conversation_id: c.conv, contact_id: c.contact, channel_session_id: c.session, inbound_message_id: c.msg, crm_event_id: randomUUID() },
      maxAttempts: 1,
    });
    return job.id;
  });
  const [claimed] = await tenant.withOrganization(c.org, () => claimJobs(tenant, { workerId: 'w-rls', maxConcurrency: 1 }));
  expect(claimed?.id).toBe(id);
  return claimed!;
}

async function semeia(c: Cenario, slug: string): Promise<void> {
  await dono.query(`insert into organizations(id, slug, legal_name, display_name) values ($1, $2, $3, $3)`, [c.org, slug, `Org ${slug}`]);
  await dono.query(`insert into neon_service_identities(user_id, organization_id, kind, active, secret_sha256) values ($1, $2, 'server', true, $3)`, [UID, c.org, sha(SEGREDO)]);
  await dono.query(`insert into contacts(id, organization_id, name, phone_number) values ($1, $2, 'Lead de Prova', $3)`, [c.contact, c.org, `+55119${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`]);
  await dono.query(`insert into channel_sessions(id, organization_id, waha_session_name, status, webhook_secret_encrypted) values ($1, $2, $3, 'WORKING', '\\x00'::bytea)`, [c.session, c.org, `sessao-${slug}`]);
  await dono.query(`insert into conversations(id, organization_id, contact_id, channel_session_id, status, is_group) values ($1, $2, $3, $4, 'ai_handling', false)`, [c.conv, c.org, c.contact, c.session]);
  await dono.query(
    `insert into messages(id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, body, sent_via, sent_at)
     values ($1, $2, $3, $4, $5, 'text', 'inbound', 'delivered', 'Oi, quero saber mais', 'external_device', now())`,
    [c.msg, c.org, c.conv, c.session, c.contact],
  );
}

suite('handlers do agent-engine sob RLS por organização (worker real)', () => {
  beforeAll(async () => {
    dono = new pg.Pool({ connectionString: DONO, max: 2 });
    appBase = new pg.Pool({ connectionString: APP, max: 6 });
    tenant = createTenantPool(appBase, { serviceUserId: UID, secret: SEGREDO });
    for (const m of [
      '20260930_0015_worker_org_context.sql',
      '20260930_0016_worker_status_para_o_health.sql',
      '20260930_0017_gravity_app_executa_funcoes_das_policies.sql',
    ]) {
      await dono.query(readFileSync(resolve(process.cwd(), 'neon/migrations', m), 'utf8'));
    }
    await dono.query(`insert into neon_auth."user"(id, email, name, "emailVerified") values ($1, $2, 'servico', true)`, [UID, `svc-${UID}@teste.local`]);
    await semeia(A, `rls-a-${A.org.slice(0, 8)}`);
    await semeia(B, `rls-b-${B.org.slice(0, 8)}`);
    await dono.query(`delete from playbook_pointers where organization_id is null`);
    await dono.query(`delete from playbook_versions where organization_id is null`);
    const v = await dono.query<{ id: string }>(`insert into playbook_versions(organization_id, layer, content) values (null, 'platform', E'## Identidade\\nAssistente de teste.') returning id`);
    await dono.query(`insert into playbook_pointers(organization_id, layer, version_id) values (null, 'platform', $1)`, [v.rows[0]!.id]);
  });

  afterAll(async () => {
    await Promise.all([dono?.end(), appBase?.end()]);
  });

  beforeEach(() => {
    enviados = [];
  });

  it('inbound_turn: o turno completo conclui sob RLS, envia UMA mensagem e grava só na organização do job', async () => {
    const job = await enfileiraEClaima(A);
    const erro = await rodaComoOWorker(job, montaHandler(modeloQueResponde('Olá! Posso ajudar com o quê?')));
    expect(erro).toBeNull();
    expect(enviados.map((e) => e.body)).toEqual(['Olá! Posso ajudar com o quê?']);

    // efeitos gravados: checkpoint e ledger da organização A, nenhum na B
    const porOrg = async (tabela: string, org: string) =>
      Number((await dono.query(`select count(*)::int n from ${tabela} where organization_id = $1`, [org])).rows[0].n);
    expect(await porOrg('lead_checkpoints', A.org)).toBeGreaterThan(0);
    expect(await porOrg('llm_calls', A.org)).toBeGreaterThan(0);
    expect(await porOrg('lead_checkpoints', B.org)).toBe(0);
    expect(await porOrg('llm_calls', B.org)).toBe(0);
    expect(Number((await dono.query(`select count(*)::int n from job_queue where id = $1 and status = 'done'`, [job.id])).rows[0].n)).toBe(1);
  });

  it('inbound_turn no tenant B, em paralelo com A: cada um conclui e nada atravessa', async () => {
    const [jobA, jobB] = [await enfileiraEClaima(A), await enfileiraEClaima(B)];
    const enviosAntes = enviados.length;
    const [ea, eb] = await Promise.all([
      rodaComoOWorker(jobA, montaHandler(modeloQueResponde('Resposta para A'))),
      rodaComoOWorker(jobB, montaHandler(modeloQueResponde('Resposta para B'))),
    ]);
    expect(ea).toBeNull();
    expect(eb).toBeNull();
    expect(enviados.slice(enviosAntes).map((e) => e.body).sort()).toEqual(['Resposta para A', 'Resposta para B']);
    for (const tabela of ['lead_checkpoints', 'llm_calls']) {
      const r = await dono.query<{ organization_id: string }>(`select distinct organization_id from ${tabela} where organization_id in ($1, $2)`, [A.org, B.org]);
      expect(r.rows.map((x) => x.organization_id).sort()).toEqual([A.org, B.org].sort());
    }
    // cada checkpoint pertence ao lead da própria organização (nenhum cruzamento)
    const cruz = await dono.query(`select count(*)::int n from lead_checkpoints k join contacts c on c.id = k.contact_id where k.organization_id <> c.organization_id`);
    expect(cruz.rows[0].n).toBe(0);
  });

  it('job de A executado no contexto de B: a RLS esconde tudo de A — nada é enviado nem gravado', async () => {
    const jobA = await enfileiraEClaima(A);
    const enviosAntes = enviados.length;
    const contar = async (tabela: string, org: string) =>
      Number((await dono.query(`select count(*)::int n from ${tabela} where organization_id = $1`, [org])).rows[0].n);
    const llmAntes = await contar('llm_calls', A.org);
    const checkpointsAntes = await contar('lead_checkpoints', A.org);
    // contexto ERRADO de propósito: a organização do contexto não é a do job
    const erro = await tenant.withOrganization(B.org, async () => {
      try {
        await withServiceJob(tenant, jobA, () => montaHandler(modeloQueResponde('Não deveria sair'))(jobA, tenant, { workerId: 'w-rls' }));
        return null;
      } catch (e) {
        return e as Error;
      }
    });
    expect(enviados.length).toBe(enviosAntes); // nada foi enviado
    expect(await contar('llm_calls', A.org)).toBe(llmAntes); // nem chamou o modelo pela conta de A
    expect(await contar('lead_checkpoints', A.org)).toBe(checkpointsAntes);
    expect(erro).not.toBeNull(); // o turno recusa: a conversa de A não existe para o contexto de B
    // devolve o job à fila para não deixar 'running' pendurado no harness
    await dono.query(`update job_queue set status = 'failed' where id = $1`, [jobA.id]);
  });
});
