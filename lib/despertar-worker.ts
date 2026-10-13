/**
 * Lado do CRM (Vercel) do despertador: avisa o worker que há trabalho novo.
 *
 * Chamado pelo `proxy.ts` em toda requisição que muda algo (POST/PUT/PATCH/DELETE) — webhook de
 * WhatsApp, formulário, botão da tela. Custa um INCR no Redis self-hosted, sem tocar no Neon. Quem
 * não tem Redis configurado não faz nada. Nunca lança e nunca atrasa a resposta: o chamador usa
 * `waitUntil` quando disponível.
 *
 * Par do `lib/agent-engine/despertador-redis.ts` (mesma chave).
 */
export const CHAVE_DO_DESPERTADOR = 'gravity:worker:acordar';

const METODOS_QUE_MUDAM = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function deveAvisar(metodo: string): boolean {
  return METODOS_QUE_MUDAM.has(String(metodo || '').toUpperCase());
}

export async function avisarWorker(
  ambiente: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const url = (ambiente.UPSTASH_REDIS_REST_URL || '').trim().replace(/^"|"$/g, '');
  const token = (ambiente.UPSTASH_REDIS_REST_TOKEN || '').trim().replace(/^"|"$/g, '');
  if (!/^https?:\/\//.test(url) || !token) return;
  try {
    await fetchImpl(url.replace(/\/+$/, ''), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['INCR', CHAVE_DO_DESPERTADOR]),
      signal: AbortSignal.timeout(1_500),
    });
  } catch {
    // Sem aviso o worker acorda pelo intervalo ocioso — atraso, nunca perda.
  }
}
