/**
 * Fila de reenvio do `call_webhook`.
 *
 * O retry imediato da ação (3 tentativas em ~6 s) cobre o soluço de rede, não
 * o destino fora do ar por uma hora — e era exatamente isso que acontecia: o
 * Gravity IA reiniciando ou caindo enquanto um lead virava "Qualificado" fazia
 * o lead sumir, com a automação marcada "Falhou" e ninguém reenviando.
 *
 * Aqui a entrega que falhou por motivo PASSAGEIRO (rede, timeout, 408/425/429,
 * 5xx) vira uma linha em `webhook_delivery_queue` e o cron `webhook-retry`
 * tenta de novo com espera crescente (~16 h no total). Erro permanente (4xx,
 * redirect, URL recusada) não entra: reenviar não muda a resposta.
 *
 * O corpo e os cabeçalhos guardados são os MESMOS da primeira tentativa
 * (inclusive a assinatura HMAC, que é do corpo e não um segredo), então o
 * destino recebe byte a byte o que teria recebido.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertDestinoResolvidoSeguro } from "@/lib/automation/outbound-ip";
import { assertSafeOutboundUrl } from "@/lib/automation/outbound-url";

// Espera antes de cada tentativa da fila, em minutos (a 1ª sai 5 min depois da falha).
export const ESPERAS_MIN = [5, 15, 30, 60, 120, 240, 480] as const;
const TIMEOUT_MS = 10_000;
const LOTE_PADRAO = 25;
// Enquanto uma tentativa está em voo a linha fica "reservada" por este tempo,
// para dois disparos simultâneos do cron não reenviarem a mesma entrega.
const RESERVA_MS = 2 * 60_000;

export function ehPassageiro(status: number | null, erro: string): boolean {
  if (status === null) {
    // Sem resposta HTTP: rede/timeout/DNS. URL recusada pelos guardas anti-SSRF
    // (`unsafe_url:*`) não é passageira — exceto falha de DNS, que é.
    return !/^unsafe_url:(?!dns_)/.test(erro);
  }
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function proximaTentativa(tentativasFeitas: number, agora: Date): Date | null {
  const espera = ESPERAS_MIN[tentativasFeitas];
  return espera === undefined ? null : new Date(agora.getTime() + espera * 60_000);
}

type Entrega = {
  organizationId: string;
  ruleId: string | null;
  eventId: string | null;
  url: string;
  headers: Record<string, string>;
  body: string;
  ultimoStatus: number | null;
  ultimoErro: string;
};

export async function enfileirar(admin: SupabaseClient, e: Entrega, agora = new Date()): Promise<string> {
  const { data, error } = await admin
    .from("webhook_delivery_queue")
    .insert({
      organization_id: e.organizationId,
      rule_id: e.ruleId,
      event_id: e.eventId,
      url: e.url,
      headers: e.headers,
      body: e.body,
      status: "pending",
      attempts: 0,
      next_attempt_at: proximaTentativa(0, agora)!.toISOString(),
      last_status: e.ultimoStatus,
      last_error: e.ultimoErro.slice(0, 500),
    })
    .select("id")
    .single();
  if (error) throw error;
  return String(data.id);
}

type Linha = {
  id: string;
  organization_id: string;
  url: string;
  headers: Record<string, string> | null;
  body: string;
  attempts: number;
};

export type ResultadoDaFila = { lidas: number; entregues: number; reagendadas: number; desistidas: number; ocupadas: number };

export async function processarFila(
  admin: SupabaseClient,
  opts: { agora?: Date; lote?: number; fetchFn?: typeof fetch; pularGuardaDeUrl?: boolean } = {},
): Promise<ResultadoDaFila> {
  const agora = opts.agora ?? new Date();
  const fetchFn = opts.fetchFn ?? fetch;
  const r: ResultadoDaFila = { lidas: 0, entregues: 0, reagendadas: 0, desistidas: 0, ocupadas: 0 };

  const { data, error } = await admin
    .from("webhook_delivery_queue")
    .select("id, organization_id, url, headers, body, attempts")
    .eq("status", "pending")
    .lte("next_attempt_at", agora.toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(opts.lote ?? LOTE_PADRAO);
  if (error) throw error;

  for (const linha of (data ?? []) as Linha[]) {
    r.lidas += 1;
    // Reserva: só segue quem conseguiu empurrar o próximo horário (condicional ao estado lido).
    const { data: reservada } = await admin
      .from("webhook_delivery_queue")
      .update({ next_attempt_at: new Date(agora.getTime() + RESERVA_MS).toISOString() })
      .eq("id", linha.id)
      .eq("status", "pending")
      .eq("attempts", linha.attempts)
      .lte("next_attempt_at", agora.toISOString())
      .select("id");
    if (!reservada || reservada.length === 0) { r.ocupadas += 1; continue; }

    let status: number | null = null;
    let erro = "";
    try {
      if (!opts.pularGuardaDeUrl) {
        assertSafeOutboundUrl(linha.url);
        await assertDestinoResolvidoSeguro(new URL(linha.url).hostname);
      }
      const res = await fetchFn(linha.url, {
        method: "POST",
        headers: { ...(linha.headers ?? {}), "X-Deskcomm-Delivery-Attempt": String(linha.attempts + 4) },
        body: linha.body,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = res.status;
      if (!res.ok) erro = res.status >= 300 && res.status < 400 ? "redirect_not_followed" : `http_${res.status}`;
    } catch (err) {
      erro = err instanceof Error ? err.message : String(err);
    }

    const feitas = linha.attempts + 1;
    const base = { attempts: feitas, last_status: status, last_error: erro.slice(0, 500) };
    if (status !== null && status >= 200 && status < 300) {
      await admin.from("webhook_delivery_queue")
        .update({ ...base, status: "delivered", delivered_at: agora.toISOString(), last_error: null })
        .eq("id", linha.id);
      r.entregues += 1;
      continue;
    }
    const proxima = ehPassageiro(status, erro) ? proximaTentativa(feitas, agora) : null;
    if (proxima) {
      await admin.from("webhook_delivery_queue").update({ ...base, next_attempt_at: proxima.toISOString() }).eq("id", linha.id);
      r.reagendadas += 1;
    } else {
      await admin.from("webhook_delivery_queue").update({ ...base, status: "failed", failed_at: agora.toISOString() }).eq("id", linha.id);
      r.desistidas += 1;
    }
  }
  return r;
}
