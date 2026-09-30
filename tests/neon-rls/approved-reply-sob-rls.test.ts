/**
 * `approved_reply` — a resposta APROVADA por um humano, entregue pelo worker, sob RLS por organização.
 *
 * O caminho de produção inteiro, menos o WhatsApp de verdade: o operador aprova o rascunho (RPC como
 * usuário autenticado), o job `approved_reply` é claimado no contexto da organização, o handler passa
 * pelas cercas do banco (`fn_reply_delivery_policy`/`fn_reply_receipt_policy`, guardadas por organização),
 * envia por HTTP para um receptor local (o transporte) e liquida o rascunho (`fn_reply_settle`). O cliente
 * administrativo do app (Data API, com identidade de serviço) é a ponte SQL do harness, como nos invariantes
 * de `autonomia-delivery-http`.
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { meetPgSupabase } from '../support/meet-pg-supabase';
import { criarOrigemDeFollowup } from '../invariants/followup-service-origin';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { createApprovedReplyHandler } from '@/lib/agent-engine/agent/approved-reply';
import { claimJobs } from '@/lib/agent-engine/queue/queue';
import { withServiceJob } from '@/lib/atendimento/fronteira-server';

import { contar, criarMundo, habilitado, logSilencioso, type Mundo } from './harness';

const suite = habilitado ? describe : describe.skip;

let m: Mundo;
const OPERADOR = randomUUID();

async function fixture(slug: string) {
  const org = randomUUID();
  const contact = randomUUID();
  const agent = randomUUID();
  const version = randomUUID();
  await m.registrarOrg(org, slug);
  await m.dono.query(`insert into user_organizations(organization_id, user_id, role, accepted_at) values ($1, $2, 'agent', now())`, [org, OPERADOR]);
  await m.dono.query(`insert into contacts(id, organization_id, name, phone_number, force_human) values ($1, $2, 'Contato', '+5531998765432', true)`, [contact, org]);
  const boundary = await criarOrigemDeFollowup(m.dono, org, contact);
  const conversation = boundary.conversation_id;
  await m.dono.query(`update conversations set assigned_to_user_id = $1 where organization_id = $2 and id = $3`, [OPERADOR, org, conversation]);
  const channel = (await m.dono.query(`select channel_session_id from conversations where organization_id = $1 and id = $2`, [org, conversation])).rows[0].channel_session_id;
  await m.dono.query(`insert into ai_agents(id, organization_id, name, system_prompt, operation_mode) values ($1, $2, 'Assistente', 'Ajude com informações confirmadas.', 'assisted')`, [agent, org]);
  await m.dono.query(
    `insert into ai_agent_versions(id, organization_id, agent_id, version_number, system_prompt, provider, model, channel_session_id, status)
     values ($1, $2, $3, 1, 'Ajude com informações confirmadas.', 'anthropic', 'claude-sonnet-4-6', $4, 'published')`,
    [version, org, agent, channel],
  );
  await m.dono.query(`update ai_agents set published_version_id = $1 where organization_id = $2 and id = $3`, [version, org, agent]);
  await m.dono.query(`insert into channel_knobs(organization_id, channel_session_id, throttle_ms, jitter_max_ms, window_start_hour, window_end_hour) values ($1, $2, 0, 0, 0, 24)`, [org, channel]);
  return { org, contact, agent, version, conversation, channel };
}

/** O operador (usuário autenticado) recebe o rascunho e o aprova: nasce o job `approved_reply`. */
async function rascunhoAprovado(f: Awaited<ReturnType<typeof fixture>>): Promise<string> {
  const d = (await m.dono.query(`select * from fn_reply_begin($1, $2, $3, $4, $5)`, [f.org, f.conversation, f.agent, f.version, randomUUID()])).rows[0];
  await m.dono.query(`update ai_reply_drafts set status = 'pending', original_body = 'Olá', edited_body = 'Olá' where organization_id = $1 and id = $2`, [f.org, d.id]);
  const c = await m.dono.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: OPERADOR, role: 'authenticated', aal: 'aal1' })]);
    const r = await c.query(`select fn_reply_action($1, $2, $3, 'approve', $4, null) as job`, [f.org, d.id, String(d.revision), 'Olá']);
    await c.query('commit');
    return r.rows[0].job as string;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

suite('approved_reply sob RLS por organização', () => {
  beforeAll(async () => {
    m = await criarMundo();
    await m.dono.query(`insert into neon_auth."user"(id, email, name, "emailVerified") values ($1, $2, 'operador', true)`, [OPERADOR, `op-${OPERADOR}@teste.local`]);
  });
  afterAll(async () => {
    await m?.fim();
  });

  it('entrega a resposta aprovada: um POST ao transporte, rascunho enviado, mensagem gravada — pelo pool do worker', async () => {
    const f = await fixture(`ar-a-${randomUUID().slice(0, 8)}`);
    const outra = await fixture(`ar-b-${randomUUID().slice(0, 8)}`);
    const jobId = await rascunhoAprovado(f);

    let posts = 0;
    const receiver = createServer(async (req, res) => {
      if (req.method === 'GET') {
        res.end(JSON.stringify({ numberExists: true, chatId: '5531998765432@c.us' }));
        return;
      }
      for await (const _ of req) {
        // esgota o corpo
      }
      posts++;
      res.end(JSON.stringify({ id: `receipt-accepted-${jobId}` }));
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
    const a = receiver.address();
    if (!a || typeof a === 'string') throw new Error('receiver');
    const url = process.env.WAHA_API_BASE_URL;
    const key = process.env.WAHA_API_KEY;
    process.env.WAHA_API_BASE_URL = `http://127.0.0.1:${a.port}`;
    process.env.WAHA_API_KEY = 'test-receiver';
    try {
      const db = meetPgSupabase(m.dono);
      vi.mocked(createAdminClient).mockReturnValue(db.client as never);

      const [job] = await m.tenant.withOrganization(f.org, () => claimJobs(m.tenant, { workerId: 'w-rls', maxConcurrency: 20, batchSize: 20 }));
      expect(job?.id).toBe(jobId);
      expect(job?.kind).toBe('approved_reply');

      await m.tenant.withOrganization(f.org, () =>
        createApprovedReplyHandler({ crmCfg: { supabase: db.client }, log: logSilencioso, sleep: async () => {} })(job!, m.tenant),
      );
      expect(db.errors, JSON.stringify(db.errors)).toEqual([]);
      expect(posts).toBe(1);

      const rascunho = await m.dono.query(`select status from ai_reply_drafts where organization_id = $1 and send_job_id = $2`, [f.org, jobId]);
      expect(rascunho.rows[0].status).toBe('sent');
      expect(await contar(m.dono, 'messages', f.org, `and direction = 'outbound' and external_id = 'receipt-accepted-${jobId}'`)).toBe(1);
      // a organização vizinha não recebeu nada
      expect(await contar(m.dono, 'messages', outra.org, `and direction = 'outbound'`)).toBe(0);
    } finally {
      if (url === undefined) delete process.env.WAHA_API_BASE_URL;
      else process.env.WAHA_API_BASE_URL = url;
      if (key === undefined) delete process.env.WAHA_API_KEY;
      else process.env.WAHA_API_KEY = key;
      receiver.closeAllConnections();
      await new Promise<void>((r) => receiver.close(() => r()));
    }
  });

  it('o job de uma organização executado no contexto de OUTRA não entrega nada', async () => {
    const f = await fixture(`ar-c-${randomUUID().slice(0, 8)}`);
    const outra = await fixture(`ar-d-${randomUUID().slice(0, 8)}`);
    const jobId = await rascunhoAprovado(f);
    const [job] = await m.tenant.withOrganization(f.org, () => claimJobs(m.tenant, { workerId: 'w-rls', maxConcurrency: 20, batchSize: 20 }));
    expect(job?.id).toBe(jobId);
    const db = meetPgSupabase(m.dono);
    vi.mocked(createAdminClient).mockReturnValue(db.client as never);
    await m.tenant
      .withOrganization(outra.org, () =>
        withServiceJob(m.tenant, job!, () => createApprovedReplyHandler({ crmCfg: { supabase: db.client }, log: logSilencioso, sleep: async () => {} })(job!, m.tenant)),
      )
      .catch(() => undefined);
    expect(await contar(m.dono, 'messages', f.org, `and direction = 'outbound'`)).toBe(0);
    const rascunho = await m.dono.query(`select status from ai_reply_drafts where organization_id = $1 and send_job_id = $2`, [f.org, jobId]);
    expect(rascunho.rows[0].status).not.toBe('sent');
  });
});
