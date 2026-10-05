"use client";

import { useQuery } from "@tanstack/react-query";

import type { Tarefa } from "@/lib/tarefas/tipos";

export interface FilaDoDia {
  queue_date: string;
  responsible_profile_id: string;
  total: number;
  tasks: Tarefa[];
}

/**
 * A fila TRAVADA do dia — diferente de `useTasks({ limite: 20 })`, que
 * recalcula a cada chamada. Esta chama `/api/v1/tasks/fila-do-dia`, que
 * materializa a seleção na primeira leitura do dia e devolve o MESMO
 * conjunto depois disso, concluindo tarefa ou não.
 */
export function useFilaDoDia(responsibleProfileId: string | null) {
  return useQuery({
    enabled: Boolean(responsibleProfileId),
    // Prefixo "crm_tasks" de propósito: `useTasks` invalida por esse prefixo
    // em toda mutação (criar/editar/apagar/concluir) — sem casar o prefixo,
    // concluir uma tarefa da fila não atualizaria a fila na hora.
    queryKey: ["crm_tasks", "fila_do_dia", responsibleProfileId],
    queryFn: async () => {
      const res = await fetch(
        `/api/v1/tasks/fila-do-dia?responsible_profile_id=${responsibleProfileId}`,
      );
      const json = (await res.json()) as { data?: FilaDoDia; error?: { message?: string } };
      if (!res.ok) {
        throw new Error(json.error?.message ?? "Não foi possível carregar a fila do dia.");
      }
      return json.data as FilaDoDia;
    },
  });
}
