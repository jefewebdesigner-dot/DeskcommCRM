import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ehPassageiro, enfileirar, processarFila, proximaTentativa, ESPERAS_MIN } from "@/lib/automation/fila-de-webhooks";
import { executeCallWebhook } from "@/lib/automation/actions/call-webhook";
import type { ActionCtx } from "@/lib/automation/types";

// Banco falso: só o pedaço do supabase-js que a fila usa, sobre uma tabela em memória.
function bancoFalso() {
  const linhas: Record<string, unknown>[] = [];
  let seq = 0;
  function consulta(tabela: string) {
    const filtros: ((r: Record<string, unknown>) => boolean)[] = [];
    let op: "select" | "update" | "insert" = "select";
    let valores: Record<string, unknown> = {};
    let limite = Infinity;
    let ordem: string | null = null;
    const alvo = () => linhas.filter((r) => filtros.every((f) => f(r)));
    const resolver = () => {
      if (tabela !== "webhook_delivery_queue") return { data: null, error: new Error("tabela inesperada") };
      if (op === "insert") { const r = { id: "q" + ++seq, ...valores }; linhas.push(r); return { data: r, error: null }; }
      if (op === "update") { const rs = alvo(); for (const r of rs) Object.assign(r, valores); return { data: rs.map((r) => ({ id: r.id })), error: null }; }
      let rs = alvo();
      if (ordem) rs = [...rs].sort((a, b) => String(a[ordem!]).localeCompare(String(b[ordem!])));
      return { data: rs.slice(0, limite).map((r) => ({ ...r })), error: null };
    };
    const b: Record<string, unknown> = {
      insert: (v: Record<string, unknown>) => { op = "insert"; valores = v; return b; },
      update: (v: Record<string, unknown>) => { op = "update"; valores = v; return b; },
      select: () => b,
      single: () => Promise.resolve(resolver()),
      eq: (k: string, v: unknown) => { filtros.push((r) => r[k] === v); return b; },
      lte: (k: string, v: string) => { filtros.push((r) => String(r[k]) <= v); return b; },
      order: (k: string) => { ordem = k; return b; },
      limit: (n: number) => { limite = n; return b; },
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, erro),
    };
    return b;
  }
  return { linhas, admin: { from: consulta } as unknown as SupabaseClient };
}

const t0 = new Date("2026-10-12T12:00:00Z");
const depois = (min: number) => new Date(t0.getTime() + min * 60_000);
const entrega = { organizationId: "org-1", ruleId: "rule-1", eventId: "evt-1", url: "https://destino.exemplo/hook",
  headers: { "Content-Type": "application/json", "X-Deskcomm-Signature": "abc" }, body: '{"event":"lead.stage_changed"}', ultimoStatus: 502, ultimoErro: "http_502" };
const resposta = (status: number) => (async () => new Response("{}", { status })) as unknown as typeof fetch;

describe("fila de reenvio do call_webhook", () => {
  it("só reenvia o que é passageiro", () => {
    expect(ehPassageiro(null, "fetch failed")).toBe(true);
    expect(ehPassageiro(null, "The operation was aborted due to timeout")).toBe(true);
    expect(ehPassageiro(null, "unsafe_url:dns_failed")).toBe(true);
    expect(ehPassageiro(null, "unsafe_url:private_ip")).toBe(false);
    for (const s of [408, 425, 429, 500, 502, 503]) expect(ehPassageiro(s, "")).toBe(true);
    for (const s of [301, 400, 401, 404, 410, 422]) expect(ehPassageiro(s, "")).toBe(false);
  });

  it("espera cresce e acaba depois da última tentativa", () => {
    expect(proximaTentativa(0, t0)!.toISOString()).toBe(depois(5).toISOString());
    expect(proximaTentativa(ESPERAS_MIN.length - 1, t0)).not.toBeNull();
    expect(proximaTentativa(ESPERAS_MIN.length, t0)).toBeNull();
  });

  it("entrega o MESMO corpo e cabeçalhos quando o destino volta", async () => {
    const { linhas, admin } = bancoFalso();
    await enfileirar(admin, entrega, t0);
    expect(linhas[0]).toMatchObject({ status: "pending", attempts: 0, next_attempt_at: depois(5).toISOString() });
    // ainda não venceu: nada acontece
    expect((await processarFila(admin, { agora: depois(1), fetchFn: resposta(200), pularGuardaDeUrl: true })).lidas).toBe(0);
    let enviado: { headers: Record<string, string>; body: string } | null = null;
    const fetchFn = (async (_u: string, init: RequestInit) => { enviado = { headers: init.headers as Record<string, string>, body: String(init.body) }; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const r = await processarFila(admin, { agora: depois(6), fetchFn, pularGuardaDeUrl: true });
    expect(r).toMatchObject({ lidas: 1, entregues: 1 });
    expect(enviado!.body).toBe(entrega.body);
    expect(enviado!.headers["X-Deskcomm-Signature"]).toBe("abc");
    expect(linhas[0]).toMatchObject({ status: "delivered", attempts: 1 });
  });

  it("reagenda erro passageiro, desiste de erro permanente e no fim das tentativas", async () => {
    const { linhas, admin } = bancoFalso();
    await enfileirar(admin, entrega, t0);
    await enfileirar(admin, { ...entrega, eventId: "evt-2" }, t0);
    linhas[1].next_attempt_at = depois(5).toISOString();
    const r = await processarFila(admin, { agora: depois(6), fetchFn: resposta(503), pularGuardaDeUrl: true });
    expect(r.reagendadas).toBe(2);
    expect(linhas[0]).toMatchObject({ status: "pending", attempts: 1, last_status: 503 });
    linhas[0].next_attempt_at = depois(6).toISOString();
    await processarFila(admin, { agora: depois(7), fetchFn: resposta(404), pularGuardaDeUrl: true });
    expect(linhas[0]).toMatchObject({ status: "failed", last_status: 404 });
    // esgotando as tentativas com erro passageiro
    linhas[1].attempts = ESPERAS_MIN.length - 1;
    linhas[1].next_attempt_at = depois(6).toISOString();
    await processarFila(admin, { agora: depois(7), fetchFn: resposta(500), pularGuardaDeUrl: true });
    expect(linhas[1]).toMatchObject({ status: "failed", attempts: ESPERAS_MIN.length });
  });

  it("dois disparos ao mesmo tempo não reenviam a mesma entrega", async () => {
    const { admin } = bancoFalso();
    await enfileirar(admin, entrega, t0);
    let chamadas = 0;
    const lento = (async () => { chamadas++; await new Promise((r) => setTimeout(r, 20)); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const [a, b] = await Promise.all([
      processarFila(admin, { agora: depois(6), fetchFn: lento, pularGuardaDeUrl: true }),
      processarFila(admin, { agora: depois(6), fetchFn: lento, pularGuardaDeUrl: true }),
    ]);
    expect(chamadas).toBe(1);
    expect(a.entregues + b.entregues).toBe(1);
  });

  it("call_webhook: destino fora do ar vira 'postponed' na fila; erro 4xx continua 'failed'", async () => {
    const { linhas, admin } = bancoFalso();
    const server = createServer((req, res) => { res.writeHead(req.url === "/404" ? 404 : 503); res.end(); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const porta = (server.address() as { port: number }).port;
    const ctx = { admin, organizationId: "org-1", ruleId: "rule-1", ruleName: "Avisar o Gravity", requestId: "req-1",
      event: { id: "evt-9", organization_id: "org-1", event_type: "lead.stage_changed", entity_kind: "crm_lead", entity_id: "l1", payload: {}, metadata: {}, consumed_by: [], attempts: 0 },
      context: { lead: { id: "l1", title: "Fulano" } } } as unknown as ActionCtx;
    try {
      const fora = await executeCallWebhook(ctx, { url: `http://127.0.0.1:${porta}/hook` }, { skipUrlCheck: true, retryDelaysMs: [0, 0] });
      expect(fora.status).toBe("postponed");
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toMatchObject({ organization_id: "org-1", rule_id: "rule-1", event_id: "evt-9", last_status: 503 });
      const recusado = await executeCallWebhook(ctx, { url: `http://127.0.0.1:${porta}/404` }, { skipUrlCheck: true, retryDelaysMs: [0, 0] });
      expect(recusado.status).toBe("failed");
      expect(linhas).toHaveLength(1);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
