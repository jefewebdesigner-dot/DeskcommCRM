"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { prepareRealtimeAuthentication } from "@/lib/supabase/browser";

export type RealtimeStatus =
  | "connecting"
  | "subscribed"
  | "channel_error"
  | "timed_out"
  | "closed";

export interface UseRealtimeChannelOpts {
  name: string;
  postgresChanges?: {
    event: "INSERT" | "UPDATE" | "DELETE" | "*";
    schema?: string;
    table: string;
    filter?: string;
  };
  broadcast?: { event: string };
  onChange: (payload: unknown) => void;
  enabled?: boolean;
}

const POLLING_MS = 3_000;

/**
 * Compatibilidade de atualização ao vivo para o backend 100% Neon.
 *
 * O Supabase Realtime saiu da arquitetura. Em vez de abrir um socket paralelo
 * sem RLS equivalente, este hook dispara reconciliações periódicas; cada
 * consumidor refaz sua consulta normal pela API/Data API, portanto a mesma
 * autenticação e as mesmas policies continuam sendo a fronteira de acesso.
 */
export function useRealtimeChannel(
  opts: UseRealtimeChannelOpts,
): {
  status: RealtimeStatus;
  ultimaEntrega: RefObject<number | null>;
} {
  const { onChange, enabled = true } = opts;
  const onChangeRef = useRef(onChange);
  const ultimaEntrega = useRef<number | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>(
    enabled ? "connecting" : "closed",
  );

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled) return;

    let cancelado = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const reconciliar = () => {
      if (cancelado || document.visibilityState === "hidden") return;
      ultimaEntrega.current = Date.now();
      onChangeRef.current({ tipo: "reassinado", source: "neon-poll" });
    };

    const iniciar = async () => {
      setStatus("connecting");
      try {
        await prepareRealtimeAuthentication();
        if (cancelado) return;
        setStatus("subscribed");

        // Primeira reconciliação fecha a janela entre o render inicial e a
        // autenticação do polling. Depois, mantém a UI fresca sem baixar tabelas.
        reconciliar();
        timer = setInterval(reconciliar, POLLING_MS);
      } catch {
        if (cancelado) return;
        setStatus("channel_error");
        timer = setInterval(async () => {
          if (cancelado) return;
          try {
            await prepareRealtimeAuthentication();
            if (cancelado) return;
            setStatus("subscribed");
            reconciliar();
          } catch {
            setStatus("channel_error");
          }
        }, Math.max(POLLING_MS, 5_000));
      }
    };

    void iniciar();

    const aoVoltar = () => {
      if (document.visibilityState === "visible" && !cancelado) reconciliar();
    };
    window.addEventListener("focus", reconciliar);
    window.addEventListener("online", reconciliar);
    document.addEventListener("visibilitychange", aoVoltar);

    return () => {
      cancelado = true;
      if (timer) clearInterval(timer);
      window.removeEventListener("focus", reconciliar);
      window.removeEventListener("online", reconciliar);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [enabled, opts.name]);

  return { status: enabled ? status : "closed", ultimaEntrega };
}
