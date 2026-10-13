/**
 * Despertador do worker — o que deixa o Neon DORMIR quando não há trabalho.
 *
 * O plano grátis do Neon cobra por hora de banco ACORDADO (100 CU-h/mês por projeto) e só deixa o
 * banco dormir depois de 5 min sem consulta. Com os laços perguntando ao banco a cada 2 s, ele nunca
 * dormia e a cota estourou (12/10/2026). Agora os laços esperam o intervalo OCIOSO longo (env, ex.
 * 15 min) e são acordados por um aviso: o CRM (Vercel) grava um contador no Redis a cada requisição
 * que muda algo (mensagem chegando, botão clicado), e o worker lê esse contador no Redis — não no
 * Neon — a cada 2 s (`despertador-redis.ts`).
 *
 * Acordado, o worker fica EM ALERTA por alguns minutos: toda espera é encurtada para poucos
 * segundos. Isso cobre a ordem dos fatos (o aviso pode chegar antes de o webhook terminar de gravar)
 * e o debounce do inbound, sem depender de um segundo aviso.
 *
 * Sem o despertador ligado (outras instalações, testes), `aguardar` é só um sleep cancelável: nada
 * muda para quem não usa.
 */
import { EventEmitter } from 'node:events';

export const JANELA_DE_ALERTA_MS = 3 * 60_000;
export const ESPERA_EM_ALERTA_MS = 3_000;

const sino = new EventEmitter();
sino.setMaxListeners(200);
let alertaAte = 0;

/** Chamado quando chega um aviso de trabalho: acorda quem está esperando e abre a janela de alerta. */
export function acordar(agora: number = Date.now()): void {
  alertaAte = agora + JANELA_DE_ALERTA_MS;
  sino.emit('acordar');
}

export function emAlerta(agora: number = Date.now()): boolean {
  return agora < alertaAte;
}

/** Em alerta, nenhuma espera passa de ESPERA_EM_ALERTA_MS; fora dele, vale o intervalo pedido. */
export function esperaEfetiva(ms: number, agora: number = Date.now()): number {
  if (ms <= 0) return 0;
  return emAlerta(agora) ? Math.min(ms, ESPERA_EM_ALERTA_MS) : ms;
}

/**
 * Espera `ms` (ajustado pelo alerta), mas volta antes se chegar um aviso ou o `signal` abortar.
 * Nunca rejeita: abortar é desligamento, e o laço confere o próprio `signal`/flag em seguida.
 */
export function aguardar(ms: number, signal?: AbortSignal): Promise<void> {
  const espera = esperaEfetiva(ms);
  if (espera <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const fim = (): void => {
      clearTimeout(timer);
      sino.off('acordar', fim);
      signal?.removeEventListener('abort', fim);
      resolve();
    };
    const timer = setTimeout(fim, espera);
    sino.on('acordar', fim);
    signal?.addEventListener('abort', fim, { once: true });
  });
}

/** Só para testes. */
export function _reiniciarDespertador(): void {
  alertaAte = 0;
  sino.removeAllListeners('acordar');
}
