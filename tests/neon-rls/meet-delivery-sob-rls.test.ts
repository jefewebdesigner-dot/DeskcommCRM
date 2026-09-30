/**
 * `transactional_delivery` — a entrega do link de reunião (Meet) pelo worker, sob RLS por organização.
 *
 * O caminho de produção: o humano autoriza a entrega, o Meet fica pronto, nasce o job
 * `transactional_delivery`; o worker o executa no contexto da organização — gates do banco
 * (`fn_meet_delivery_policy`), ledger, cadeia de guardas, HTTP ao transporte (receptor local) e liquidação
 * (`fn_meet_delivery_settle`), tudo pelo pool com contexto. Com a sessão fora do ar o envio FICA na fila
 * (nada sai); com ela de volta, sai uma vez. Adaptado de `tests/invariants/agenda-meet.test.ts`.
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { meetPgSupabase } from '../support/meet-pg-supabase';
import { criarOrigemDeFollowup } from '../invariants/followup-service-origin';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { appointmentSnapshotSchema, expectedAppointment } from '@/lib/agenda/google/sync-store';
import { createMeetDeliveryHandler } from '@/lib/agent-engine/agent/meet-delivery';
import { claimJobs } from '@/lib/agent-engine/queue/queue';

import { contar, criarMundo, habilitado, type Mundo } from './harness';

const suite = habilitado ? describe : describe.skip;

let m: Mundo;
const OPERADOR = randomUUID();

async function fixture(slug: string) {
  const org = randomUUID();
  const id = randomUUID();
  const contact = randomUUID();
  const conn = randomUUID();
  await m.registrarOrg(org, slug);
  await m.dono.query(`insert into user_organizations(organization_id, user_id, role, accepted_at) values ($1, $2, 'agent', now())`, [org, OPERADOR]);
  await m.dono.query(`insert into contacts(id, organization_id, name, display_name) values ($1, $2, 'Cliente Meet', 'Cliente Meet')`, [contact, org]);
  const boundary = await criarOrigemDeFollowup(m.dono, org, contact);
  await m.dono.query(
    `insert into calendar_connections(id, organization_id, user_id, provider, account_email, status) values ($1, $2, $3, 'google_calendar', $4, 'healthy')`,
    [conn, org, OPERADOR, `${conn}@example.test`],
  );
  await m.dono.query(
    `insert into calendar_connection_calendars(organization_id, connection_id, external_calendar_id, name, is_destination, access_role, allowed_conference_types)
     values ($1, $2, 'meet-calendar', 'Meet', true, 'owner', array['hangoutsMeet'])`,
    [org, conn],
  );
  await m.dono.query(
    `insert into calendar_appointments(id, organization_id, contact_id, conversation_id, owner_user_id, title, starts_at, ends_at, status, location_kind)
     values ($1, $2, $3, $4, $5, 'Reunião', now() + interval '4 days', now() + interval '4 days 1 hour', 'confirmed', 'google_meet')`,
    [id, org, contact, boundary.conversation_id, OPERADOR],
  );
  return { org, id, contact, boundary };
}

const app = async (f: Awaited<ReturnType<typeof fixture>>, action: string, args: unknown = {}) =>
  (await m.dono.query(`select fn_google_appointment($1, $2, $3, $4) r`, [f.org, f.id, action, args])).rows[0].r;

async function comoOperador(sql: string, args: unknown[]) {
  const c = await m.dono.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: OPERADOR, role: 'authenticated', aal: 'aal1' })]);
    const r = await c.query(sql, args);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

suite('transactional_delivery sob RLS por organização', () => {
  beforeAll(async () => {
    m = await criarMundo();
    await m.dono.query(`insert into neon_auth."user"(id, email, name, "emailVerified") values ($1, $2, 'operador', true)`, [OPERADOR, `op-${OPERADOR}@teste.local`]);
  });
  afterAll(async () => {
    await m?.fim();
  });

  it('sessão fora do ar: nada sai e o job volta à fila; sessão de volta: sai UMA mensagem com o link — tudo pelo pool do worker', async () => {
    const f = await fixture(`md-a-${randomUUID().slice(0, 8)}`);
    const outra = await fixture(`md-b-${randomUUID().slice(0, 8)}`);
    await m.dono.query(`update contacts set phone_number = '+15551234567', ai_authorized_at = now() where id = $1`, [f.contact]);
    const channel = (await m.dono.query(`select channel_session_id from conversations where id = $1`, [f.boundary.conversation_id])).rows[0].channel_session_id;
    await m.dono.query(`insert into channel_knobs(organization_id, channel_session_id, throttle_ms, jitter_max_ms, window_start_hour, window_end_hour) values ($1, $2, 0, 0, 0, 24)`, [f.org, channel]);
    await m.dono.query(`update conversations set assignee_kind = 'ai', bot_silenced_until = null where id = $1`, [f.boundary.conversation_id]);

    const a = appointmentSnapshotSchema.parse(await app(f, 'claim'));
    await comoOperador('select fn_meet_action($1, $2, $3, $4, $5, $6) r', [f.org, f.id, a.revision, a.meeting_request_id, 'deliver', f.boundary.conversation_id]);
    await app(f, 'meet', { ...expectedAppointment(a), result: { state: 'ready', received: true, url: 'https://meet.google.com/abc-defg-hij', error: null } });
    const jobId = (await m.dono.query(`select meeting_delivery_job_id from calendar_appointments where id = $1`, [f.id])).rows[0].meeting_delivery_job_id;

    const bodies: Array<Record<string, unknown>> = [];
    const receiver = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += String(chunk);
      bodies.push(raw ? JSON.parse(raw) : {});
      res.end(JSON.stringify({ id: 'local-message-1' }));
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
    const addr = receiver.address();
    if (!addr || typeof addr === 'string') throw new Error('receiver');
    const url = process.env.WAHA_API_BASE_URL;
    const key = process.env.WAHA_API_KEY;
    process.env.WAHA_API_BASE_URL = `http://127.0.0.1:${addr.port}`;
    process.env.WAHA_API_KEY = 'receiver-only';
    try {
      const db = meetPgSupabase(m.dono);
      vi.mocked(createAdminClient).mockReturnValue(db.client as never);
      const handler = createMeetDeliveryHandler({ crmCfg: { supabase: db.client }, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, sleep: async () => {} });

      // 1) sessão FORA: o job é claimado pelo worker no contexto, o envio fica em fila
      await m.dono.query(`update channel_sessions set status = 'STOPPED' where id = $1`, [channel]);
      const [claimed] = await m.tenant.withOrganization(f.org, () => claimJobs(m.tenant, { workerId: 'w-rls', maxConcurrency: 20, batchSize: 20 }));
      expect(claimed?.id).toBe(jobId);
      expect(claimed?.kind).toBe('transactional_delivery');
      await m.tenant.withOrganization(f.org, () => handler(claimed!, m.tenant, { workerId: 'w-rls' }));
      expect(bodies).toHaveLength(0);
      expect((await m.dono.query(`select status from job_queue where id = $1`, [jobId])).rows[0].status).toBe('pending');
      expect((await m.dono.query(`select status from send_ledger where job_id = $1`, [jobId])).rows[0].status).toBe('queued');

      // 2) sessão DE VOLTA: sai uma vez
      await m.dono.query(`update channel_sessions set status = 'WORKING' where id = $1`, [channel]);
      const segundo = (
        await m.dono.query(`update job_queue set status = 'running', locked_by = 'w-rls', locked_at = clock_timestamp(), attempts = attempts + 1 where id = $1 returning *, locked_at::text claim_acquired_at`, [jobId])
      ).rows[0];
      await m.tenant.withOrganization(f.org, () => handler(segundo, m.tenant, { workerId: 'w-rls' }));
      // (db.errors acumula também o 23505 esperado do reenvio de uma mensagem já enfileirada: o que vale é o estado)
      const estado = (await m.dono.query(`select meeting_delivery from calendar_appointments where id = $1`, [f.id])).rows[0].meeting_delivery;
      expect(estado.state, JSON.stringify(db.errors)).toBe('sent');
      expect(bodies).toHaveLength(1);
      expect(bodies[0]!.text).toContain('https://meet.google.com/abc-defg-hij');
      expect(await contar(m.dono, 'messages', f.org, `and contact_id = '${f.contact}'`)).toBe(1);
      expect((await m.dono.query(`select status from send_ledger where job_id = $1`, [jobId])).rows[0].status).toBe('accepted');
      // a organização vizinha continua sem nenhuma mensagem
      expect(await contar(m.dono, 'messages', outra.org)).toBe(0);
    } finally {
      if (url === undefined) delete process.env.WAHA_API_BASE_URL;
      else process.env.WAHA_API_BASE_URL = url;
      if (key === undefined) delete process.env.WAHA_API_KEY;
      else process.env.WAHA_API_KEY = key;
      receiver.closeAllConnections();
      await new Promise<void>((r) => receiver.close(() => r()));
    }
  });
});
