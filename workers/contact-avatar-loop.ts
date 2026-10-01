/**
 * Loop nativo de fotos de perfil.
 *
 * Drena rapidamente o backlog inicial e, quando não há lote cheio, recua.
 * A função de sync só escolhe contatos nunca verificados ou com foto >7 dias,
 * então o loop pode ser permanente sem martelar o provider.
 */
import type { Logger } from "@/lib/agent-engine/obs/logger";
import {
  AVATAR_SCAN_LIMIT,
  sincronizarAvataresContatos,
} from "@/lib/contacts/avatar-sync";

export interface ContactAvatarLoopKnobs {
  batchSize?: number;
  busyIntervalMs?: number;
  idleIntervalMs?: number;
  errorIntervalMs?: number;
}

function esperar(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function runContactAvatarLoop(
  knobs: ContactAvatarLoopKnobs,
  log: Logger,
  signal: AbortSignal,
): Promise<void> {
  const batchSize = Math.min(
    Math.max(knobs.batchSize ?? AVATAR_SCAN_LIMIT, 1),
    100,
  );
  const busyIntervalMs = Math.max(knobs.busyIntervalMs ?? 1_000, 250);
  const idleIntervalMs = Math.max(
    knobs.idleIntervalMs ?? 6 * 60 * 60 * 1000,
    60_000,
  );
  const errorIntervalMs = Math.max(knobs.errorIntervalMs ?? 60_000, 5_000);

  while (!signal.aborted) {
    let espera = idleIntervalMs;
    try {
      const r = await sincronizarAvataresContatos({
        limit: batchSize,
        requestId: "worker-contact-avatars",
      });

      if (r.scanned > 0) {
        log.info("contact avatars: lote concluído", { ...r });
      }
      espera = r.scanned >= batchSize ? busyIntervalMs : idleIntervalMs;
    } catch (err) {
      log.error("contact avatars: lote falhou", {
        error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      });
      espera = errorIntervalMs;
    }

    if (!signal.aborted) await esperar(espera, signal);
  }
}
