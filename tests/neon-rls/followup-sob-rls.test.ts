/**
 * `followup_turn` — o handler REAL, dirigido por fluxo, sob RLS por organização (worker de verdade).
 *
 * Caminho completo de produção: o motor de fluxo (aqui com a role dona, que é onde o cron HTTP roda)
 * enfileira o job `followup_turn`; o worker o claima no contexto da organização, o handler passa pelas
 * cercas (`withServiceJob`, fronteira de atendimento, janela), envia o corpo fixo do passo e devolve o
 * resultado ao enrollment pela ponte (`fn_followup_apply_step`/`fn_followup_patch`, guardadas por
 * organização). Modelo não é chamado: o passo é `mode: 'text'`.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createFollowupTurnHandler } from '@/lib/agent-engine/agent/followup-turn';
import { claimJobs, completeJob, failJob, type JobRow } from '@/lib/agent-engine/queue/queue';
import { withServiceJob } from '@/lib/atendimento/fronteira-server';
import { runFollowupTick, type FollowupJobRequest } from '@/lib/followup/engine';
import { flowGraphSchema, type FlowGraph } from '@/lib/followup/graph-schema';
import { completeTurnForEnrollment, createPgAdminClient } from '@/lib/followup/turn-bridge';

import { criarOrigemDeFollowup } from '../invariants/followup-service-origin';
import { relogioAncoradoNoBanco } from '../invariants/followup-relogio';
import { contar, criarMundo, habilitado, logSilencioso, type Mundo } from './harness';

const suite = habilitado ? describe : describe.skip;

const GRAFO: FlowGraph = {
  nodes: [
    { id: 'a1', type: 'action', label: 'Lembrete', position: { x: 0, y: 0 }, config: { mode: 'text', body: 'Oi! Só passando para lembrar do nosso combinado.' } },
    { id: 'e1', type: 'end', label: 'Fim', position: { x: 0, y: 0 }, config: { outcome: 'converted' } },
  ],
  edges: [{ id: 'a1-e1', source: 'a1', target: 'e1', priority: 0, condition: { type: 'always' } }],
};

let m: Mundo;
const enviados: Array<{ body: string }> = [];

interface Org {
  org: string;
  contact: string;
  enrollment: string;
}

async function semeia(slug: string): Promise<Org> {
  const org = randomUUID();
  await m.registrarOrg(org, slug);
  const contact = (await m.dono.query<{ id: string }>(`insert into contacts(organization_id, name, phone_number) values ($1, 'Contato', $2) returning id`, [org, `+55119${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`])).rows[0]!.id;
  const versao = (await m.dono.query<{ id: string }>(`insert into followup_flow_versions(organization_id, graph) values ($1, $2) returning id`, [org, JSON.stringify(GRAFO)])).rows[0]!.id;
  const pointer = (await m.dono.query<{ id: string }>(`insert into followup_flow_pointers(organization_id, name, status, active_version_id) values ($1, $2, 'active', $3) returning id`, [org, `Fluxo ${slug}`, versao])).rows[0]!.id;
  const boundary = await criarOrigemDeFollowup(m.dono, org, contact);
  const enrollment = (
    await m.dono.query<{ id: string }>(
      `insert into followup_enrollments(organization_id, pointer_id, version_id, contact_id, current_node_id, status, next_eval_at, steps_taken, conversation_id, service_boundary)
       values ($1, $2, $3, $4, 'a1', 'active', now() - interval '1 second', 0, $5, $6::jsonb) returning id`,
      [org, pointer, versao, contact, boundary.conversation_id, JSON.stringify(boundary)],
    )
  ).rows[0]!.id;
  return { org, contact, enrollment };
}

function montaHandler() {
  return createFollowupTurnHandler({
    crmCfg: { supabase: {} as never },
    llmCfg: { anthropicApiKey: 'fake' } as never,
    knobs: {
      historyLimit: 10,
      maxContextTokens: 1000,
      notesIndexMaxTokens: 500,
      maxSteps: 4,
      queuedRetryDelayMs: 1000,
      breaker: { exactFailureWarn: 2, exactFailureBlock: 5, sameToolFailureWarn: 3, sameToolFailureHalt: 8, noProgressWarn: 3, noProgressBlock: 5 },
    },
    log: logSilencioso,
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
    clock: () => new Date('2026-07-28T18:00:00Z'), // terça 15h BRT
    sleep: async () => {},
    // a MESMA ponte que o main.ts injeta em produção, sobre o pool do worker
    completeFollowupTurn: (pool, { organizationId, enrollmentId, nodeId, jobId, jobClaim, result }) =>
      completeTurnForEnrollment(createPgAdminClient(pool), organizationId, enrollmentId, nodeId, result, undefined, jobId, jobClaim),
  });
}

/** O motor de fluxo (cron HTTP, role dona) enfileira o job — exatamente o `enqueueJob` da rota. */
async function motorEnfileira(org: string): Promise<void> {
  const pedidos: FollowupJobRequest[] = [];
  await runFollowupTick(
    {
      db: createPgAdminClient(m.dono),
      clock: relogioAncoradoNoBanco(),
      enqueueJob: async (job) => {
        pedidos.push(job);
        await m.dono.query(`insert into job_queue(organization_id, contact_id, kind, payload) values ($1, $2, 'followup_turn', $3)`, [job.organization_id, job.contact_id, JSON.stringify(job.payload)]);
      },
    },
    { limit: 50 },
  );
  expect(pedidos.filter((p) => p.organization_id === org)).toHaveLength(1);
}

async function workerExecuta(org: string, handler = montaHandler()): Promise<{ job: JobRow; erro: Error | null }> {
  const [job] = await m.tenant.withOrganization(org, () => claimJobs(m.tenant, { workerId: 'w-rls', maxConcurrency: 20, batchSize: 20 }));
  expect(job?.kind).toBe('followup_turn');
  const erro = await m.tenant.withOrganization(org, async () => {
    try {
      await withServiceJob(m.tenant, job!, () => handler(job!, m.tenant, { workerId: 'w-rls' }));
      await completeJob(m.tenant, job!.id, 'w-rls', undefined, job!.claim_acquired_at);
      return null;
    } catch (e) {
      await failJob(m.tenant, job!.id, 'w-rls', e, job!.claim_acquired_at);
      return e as Error;
    }
  });
  return { job: job!, erro };
}

suite('followup_turn sob RLS por organização', () => {
  beforeAll(async () => {
    m = await criarMundo();
    flowGraphSchema.parse(GRAFO);
  });
  afterAll(async () => {
    await m?.fim();
  });

  it('o ciclo completo conclui sob RLS: envia o corpo fixo, avança o enrollment e não toca a organização vizinha', async () => {
    const A = await semeia(`fu-a-${randomUUID().slice(0, 8)}`);
    const B = await semeia(`fu-b-${randomUUID().slice(0, 8)}`);
    await motorEnfileira(A.org);
    // o job de B também foi enfileirado pelo motor: fica na fila, intocado, enquanto A executa
    const antes = enviados.length;
    const { erro } = await workerExecuta(A.org);
    expect(erro).toBeNull();
    expect(enviados.length).toBe(antes + 1);
    expect(enviados.at(-1)!.body).toContain('lembrar do nosso combinado');

    const enrol = await m.dono.query(`select current_node_id, status from followup_enrollments where id = $1`, [A.enrollment]);
    expect(enrol.rows[0]).toMatchObject({ current_node_id: 'e1' });
    const eventos = await m.dono.query<{ event_type: string }>(`select event_type from followup_enrollment_events where enrollment_id = $1 order by created_at`, [A.enrollment]);
    expect(eventos.rows.map((r) => r.event_type)).toEqual(['turn_enqueued', 'action_sent']);

    // B: nada aconteceu — enrollment no mesmo nó, job ainda pendente
    const enrolB = await m.dono.query(`select current_node_id from followup_enrollments where id = $1`, [B.enrollment]);
    expect(enrolB.rows[0].current_node_id).toBe('a1');
    expect(await contar(m.dono, 'job_queue', B.org, `and kind = 'followup_turn' and status = 'pending'`)).toBe(1);
  });

  it('o job de B executado no contexto de A não é claimado nem executado: a RLS o esconde', async () => {
    const B = await semeia(`fu-c-${randomUUID().slice(0, 8)}`);
    const A = await semeia(`fu-d-${randomUUID().slice(0, 8)}`);
    await motorEnfileira(B.org).catch(() => undefined);
    const claimed = await m.tenant.withOrganization(A.org, () => claimJobs(m.tenant, { workerId: 'w-rls', maxConcurrency: 20, batchSize: 20 }));
    expect(claimed.every((j) => j.organization_id === A.org)).toBe(true);
    expect(claimed.some((j) => j.organization_id === B.org)).toBe(false);
  });
});
