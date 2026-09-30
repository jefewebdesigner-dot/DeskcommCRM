/**
 * `case_reply_turn` e `operator_turn` — os handlers REAIS sob RLS por organização (worker de verdade).
 *
 * `runAgentTurn` é mockado (o mesmo recorte de `tests/invariants/case-reply-turn.test.ts`): o que se prova
 * aqui é o acesso ao BANCO do handler — resolver caso→conversa, ler declaração do turno, abrir aviso —
 * feito pelo pool do worker, no contexto da organização do job, e nunca na do vizinho.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/agent-engine/agent/inbound-turn', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agent-engine/agent/inbound-turn')>();
  return { ...actual, runAgentTurn: vi.fn() };
});

import { createCaseReplyTurnHandler } from '@/lib/agent-engine/agent/case-reply-turn';
import { runAgentTurn, type InboundTurnDeps } from '@/lib/agent-engine/agent/inbound-turn';
import { createOperatorTurnHandler, lerDeclaracaoDoTurno } from '@/lib/agent-engine/agent/operator-turn';
import type { JobRow } from '@/lib/agent-engine/queue/queue';

import { contar, criarMundo, habilitado, logSilencioso, type Mundo } from './harness';

const suite = habilitado ? describe : describe.skip;

interface Org {
  org: string;
  contact: string;
  session: string;
  conv: string;
}
const nova = (): Org => ({ org: randomUUID(), contact: randomUUID(), session: randomUUID(), conv: randomUUID() });
const A = nova();
const B = nova();

let m: Mundo;

const deps = (): InboundTurnDeps => ({
  crmCfg: { supabase: {} as never },
  llmCfg: {} as never,
  knobs: {
    historyLimit: 20,
    maxContextTokens: 1_000,
    notesIndexMaxTokens: 500,
    maxSteps: 6,
    queuedRetryDelayMs: 1_000,
    breaker: { exactFailureWarn: 2, exactFailureBlock: 4, sameToolFailureWarn: 3, sameToolFailureHalt: 6, noProgressWarn: 2, noProgressBlock: 4 },
  },
  log: logSilencioso,
});

const job = (o: Org, kind: 'case_reply_turn' | 'operator_turn', payload: Record<string, unknown>): JobRow => ({
  id: randomUUID(),
  organization_id: o.org,
  contact_id: o.contact,
  kind,
  source_event_id: null,
  payload,
  status: 'running',
  priority: 100,
  run_after: new Date(),
  attempts: 0,
  max_attempts: 5,
  last_error: null,
  locked_by: 'w-rls',
  locked_at: new Date(),
  created_at: new Date(),
});

async function semeiaBase(o: Org, slug: string): Promise<void> {
  await m.registrarOrg(o.org, slug);
  await m.dono.query(`insert into contacts(id, organization_id, name, phone_number) values ($1, $2, 'Contato', $3)`, [o.contact, o.org, `+55119${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`]);
  await m.dono.query(`insert into channel_sessions(id, organization_id, waha_session_name, status, webhook_secret_encrypted) values ($1, $2, $3, 'WORKING', '\\x00'::bytea)`, [o.session, o.org, `s-${slug}`]);
  await m.dono.query(`insert into conversations(id, organization_id, contact_id, channel_session_id, status, is_group) values ($1, $2, $3, $4, 'ai_handling', false)`, [o.conv, o.org, o.contact, o.session]);
}

suite('case_reply_turn e operator_turn sob RLS', () => {
  let casoResolvidoA: string;
  let casoResolvidoB: string;

  beforeAll(async () => {
    m = await criarMundo();
    await semeiaBase(A, `casos-a-${A.org.slice(0, 8)}`);
    await semeiaBase(B, `casos-b-${B.org.slice(0, 8)}`);
    casoResolvidoA = randomUUID();
    casoResolvidoB = randomUUID();
    for (const [id, o] of [[casoResolvidoA, A], [casoResolvidoB, B]] as const) {
      await m.dono.query(
        `insert into agent_cases(id, organization_id, conversation_id, title, summary, blocker, status, closed_at) values ($1, $2, $3, 'Caso', 'resumo', 'bloqueio', 'resolved', now())`,
        [id, o.org, o.conv],
      );
    }
  });

  afterAll(async () => {
    await m?.fim();
  });

  beforeEach(() => {
    vi.mocked(runAgentTurn).mockReset();
    vi.mocked(runAgentTurn).mockResolvedValue(undefined);
  });

  // ── case_reply_turn ─────────────────────────────────────────────────────────────────────
  it('case_reply_turn: resolve a conversa do caso lendo pelo pool do worker e chama o turno com os ids da organização', async () => {
    const j = job(A, 'case_reply_turn', { case_id: casoResolvidoA, action: 'resolved', body: 'cliente liberado no sistema X' });
    await m.tenant.withOrganization(A.org, () => createCaseReplyTurnHandler(deps())(j, m.tenant, { workerId: 'w-rls' }));
    expect(runAgentTurn).toHaveBeenCalledTimes(1);
    const input = vi.mocked(runAgentTurn).mock.calls[0]![4]!;
    expect(input.conversationId).toBe(A.conv);
    expect(input.channelSessionId).toBe(A.session);
  });

  it('case_reply_turn: caso de OUTRA organização é invisível — no-op, o turno nunca roda', async () => {
    // job da organização A apontando para o caso da B, executado no contexto correto (A)
    const j = job(A, 'case_reply_turn', { case_id: casoResolvidoB, action: 'resolved', body: 'tentativa cruzada' });
    await expect(m.tenant.withOrganization(A.org, () => createCaseReplyTurnHandler(deps())(j, m.tenant, { workerId: 'w-rls' }))).resolves.toBeUndefined();
    expect(runAgentTurn).not.toHaveBeenCalled();
  });

  it('case_reply_turn: job de A no contexto de B não enxerga o caso de A', async () => {
    const j = job(A, 'case_reply_turn', { case_id: casoResolvidoA, action: 'resolved', body: 'contexto errado' });
    await expect(m.tenant.withOrganization(B.org, () => createCaseReplyTurnHandler(deps())(j, m.tenant, { workerId: 'w-rls' }))).resolves.toBeUndefined();
    expect(runAgentTurn).not.toHaveBeenCalled();
  });

  // ── operator_turn ───────────────────────────────────────────────────────────────────────
  describe('operator_turn', () => {
    const J1 = randomUUID();
    const J2 = randomUUID();
    const agente = randomUUID();
    const versao = randomUUID();
    const COM_PROMESSA = { intencoes: [{ o_que: 'quer confirmar horário', evidencia: 'dá terça?' }], promessas: [{ o_que: 'confirmo o horário e te aviso', prazo: null }], nada_a_declarar: false };
    const SEM_NADA = { intencoes: [], promessas: [], nada_a_declarar: true };

    beforeAll(async () => {
      await m.dono.query(`insert into ai_agents(id, organization_id, name, system_prompt) values ($1, $2, 'Agente', 'system')`, [agente, A.org]);
      await m.dono.query(
        `insert into ai_agent_versions(id, organization_id, agent_id, version_number, system_prompt, provider, model, channel_session_id, status, operator_enabled)
         values ($1, $2, $3, 1, 'system', 'anthropic', 'claude-sonnet-4-6', $4, 'published', true)`,
        [versao, A.org, agente, A.session],
      );
      await m.dono.query(`update ai_agents set published_version_id = $1 where id = $2`, [versao, agente]);
      for (const id of [J1, J2]) {
        await m.dono.query(`insert into job_queue(id, organization_id, contact_id, kind, payload) values ($1, $2, $3, 'inbound_turn', '{}')`, [id, A.org, A.contact]);
      }
      await m.dono.query(`insert into lead_checkpoints(organization_id, contact_id, job_id, rolling_summary, declaracao) values ($1, $2, $3, 'prometeu', $4::jsonb)`, [A.org, A.contact, J1, JSON.stringify(COM_PROMESSA)]);
      await m.dono.query(`insert into lead_checkpoints(organization_id, contact_id, job_id, rolling_summary, declaracao) values ($1, $2, $3, 'nada', $4::jsonb)`, [A.org, A.contact, J2, JSON.stringify(SEM_NADA)]);
    });

    it('a leitura da declaração é pela chave do turno, pelo pool do worker', async () => {
      const [d1, d2] = await m.tenant.withOrganization(A.org, async () => [
        await lerDeclaracaoDoTurno(m.tenant, A.org, A.contact, J1),
        await lerDeclaracaoDoTurno(m.tenant, A.org, A.contact, J2),
      ]);
      expect(d1.declaracao?.promessas).toHaveLength(1);
      expect(d2.declaracao?.nada_a_declarar).toBe(true);
    });

    it('o handler real abre o aviso da promessa DENTRO da organização A (e a B continua limpa)', async () => {
      const op = job(A, 'operator_turn', { conversation_id: A.conv, origin_job_id: J1, agent_id: agente });
      await m.tenant.withOrganization(A.org, () => createOperatorTurnHandler(deps())(op, m.tenant, { workerId: 'w-rls' }));
      expect(await contar(m.dono, 'agent_inbox_items', A.org, `and kind = 'promise_unfulfilled'`)).toBe(1);
      expect(await contar(m.dono, 'agent_inbox_items', B.org)).toBe(0);
    });

    it('guarda de vacuidade: apontado para o turno sem declaração, o handler NÃO abre aviso', async () => {
      await m.dono.query(`delete from agent_inbox_items where organization_id = $1`, [A.org]);
      const op = job(A, 'operator_turn', { conversation_id: A.conv, origin_job_id: J2, agent_id: agente });
      await m.tenant.withOrganization(A.org, () => createOperatorTurnHandler(deps())(op, m.tenant, { workerId: 'w-rls' }));
      expect(await contar(m.dono, 'agent_inbox_items', A.org, `and kind = 'promise_unfulfilled'`)).toBe(0);
    });

    it('o mesmo job no contexto de B não vê nada de A: nenhum aviso, nenhum efeito', async () => {
      await m.dono.query(`delete from agent_inbox_items where organization_id = $1`, [A.org]);
      const op = job(A, 'operator_turn', { conversation_id: A.conv, origin_job_id: J1, agent_id: agente });
      await m.tenant.withOrganization(B.org, async () => {
        await createOperatorTurnHandler(deps())(op, m.tenant, { workerId: 'w-rls' }).catch(() => undefined);
      });
      expect(await contar(m.dono, 'agent_inbox_items', A.org)).toBe(0);
      expect(await contar(m.dono, 'agent_inbox_items', B.org)).toBe(0);
    });
  });
});
