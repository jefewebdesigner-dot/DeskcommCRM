"use client";

import { useQuery } from "@tanstack/react-query";

import type { PerfilResponsavelTarefa } from "@/lib/tarefas/tipos";

export function useTaskResponsibles() {
  return useQuery({
    queryKey: ["crm_task_responsibles"],
    queryFn: async () => {
      const res = await fetch("/api/v1/tasks/responsibles");
      if (!res.ok) throw new Error("Não foi possível carregar os responsáveis.");
      const json = (await res.json()) as {
        data: { responsaveis: PerfilResponsavelTarefa[] };
      };
      return json.data.responsaveis;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}
