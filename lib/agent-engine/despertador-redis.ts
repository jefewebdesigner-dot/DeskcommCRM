/**
 * Escuta do despertador no Redis (REST do Upstash/SRH — o mesmo que o CRM já usa, self-hosted).
 *
 * O CRM incrementa `CHAVE_DO_DESPERTADOR` a cada requisição que muda algo; aqui o worker troca o
 * valor por "0" (GETSET) a cada `intervaloMs`. Valor anterior > 0 = houve trabalho novo → `acordar()`.
 * Consultar o Redis não acorda o Neon, e é isso que deixa o banco dormir quando está tudo parado.
 *
 * Falha do Redis nunca derruba o worker: ele só deixa de ser acordado cedo e cai no intervalo ocioso
 * (a rede de segurança de sempre). O erro é logado uma vez por sequência, não a cada 2 s.
 */
import { acordar } from './despertador';

export const CHAVE_DO_DESPERTADOR = 'gravity:worker:acordar';

interface LogMinimo {
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface OpcoesDaEscuta {
  url: string;
  token: string;
  intervaloMs?: number;
  signal: AbortSignal;
  log: LogMinimo;
  fetchImpl?: typeof fetch;
}

/** Uma leitura: devolve true se havia aviso pendente (e o zera). */
export async function lerAviso(opts: Pick<OpcoesDaEscuta, 'url' | 'token' | 'fetchImpl'>): Promise<boolean> {
  const f = opts.fetchImpl ?? fetch;
  const r = await f(opts.url.replace(/\/+$/, ''), {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['GETSET', CHAVE_DO_DESPERTADOR, '0']),
    signal: AbortSignal.timeout(5_000),
  });
  if (!r.ok) throw new Error(`redis respondeu ${r.status}`);
  const j = (await r.json()) as { result?: unknown };
  const n = Number(j?.result ?? 0);
  return Number.isFinite(n) && n > 0;
}

export async function escutarDespertador(opts: OpcoesDaEscuta): Promise<void> {
  const intervalo = opts.intervaloMs ?? 2_000;
  let falhando = false;
  opts.log.info('despertador: escutando o Redis', { intervalo_ms: intervalo });
  while (!opts.signal.aborted) {
    try {
      if (await lerAviso(opts)) acordar();
      if (falhando) opts.log.info('despertador: Redis voltou', {});
      falhando = false;
    } catch (err) {
      if (!falhando) {
        opts.log.warn('despertador: Redis indisponível — o worker segue no intervalo ocioso', {
          error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
        });
      }
      falhando = true;
    }
    await new Promise<void>((resolve) => {
      const fim = (): void => {
        clearTimeout(t);
        opts.signal.removeEventListener('abort', fim);
        resolve();
      };
      const t = setTimeout(fim, intervalo);
      opts.signal.addEventListener('abort', fim, { once: true });
    });
  }
}
