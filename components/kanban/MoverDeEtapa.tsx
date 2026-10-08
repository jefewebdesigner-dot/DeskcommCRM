"use client";

import { toast } from "sonner";

import { useT } from "@/hooks/i18n/useT";
import { useMoveCard } from "@/hooks/kanban/useMoveCard";
import { etapasParaMover, posicaoNoFimDaEtapa } from "@/lib/kanban/mover-de-etapa";
import type { Stage } from "@/lib/kanban/types";
import type { Lead } from "@/lib/types/leads";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * "Em que etapa está — e para onde vai": o seletor que faltava.
 *
 * Mudar a etapa só existia ARRASTANDO o card entre colunas. Quem trabalha numa
 * lista, no celular ou dentro do dossiê não arrasta nada, e a etapa aparecia
 * como texto parado — ou seja, a pessoa via onde o negócio estava e não tinha
 * como avançá-lo de onde estava olhando.
 *
 * Usa a MESMA ação do arrastar (`useMoveCard`: otimista, com checagem de
 * versão e desfaz em erro), não uma rota paralela — as regras de mover (ganho,
 * motivo de perda, atividade na timeline) continuam sendo uma só.
 */
export function MoverDeEtapa({
  lead,
  pipelineId,
  stages,
  leads,
  className,
}: {
  lead: Pick<Lead, "id" | "stage_id" | "updated_at">;
  pipelineId: string;
  stages: Stage[];
  /** Todos os negócios do funil — só para saber onde cabe "no fim" da etapa. */
  leads: Pick<Lead, "id" | "stage_id" | "position_in_stage">[];
  className?: string;
}) {
  const t = useT();
  const mover = useMoveCard(pipelineId);
  const opcoes = etapasParaMover(stages, lead.stage_id);

  function aoEscolher(stageId: string) {
    if (stageId === lead.stage_id) return;
    const destino = opcoes.find((s) => s.id === stageId);
    mover.mutate(
      {
        leadId: lead.id,
        stageId,
        positionInStage: posicaoNoFimDaEtapa(leads, stageId, lead.id),
        expectedUpdatedAt: lead.updated_at,
      },
      {
        onSuccess: () => toast.success(`${t("Movido para")} ${destino?.name ?? t("a nova etapa")}`),
      },
    );
  }

  return (
    <Select value={lead.stage_id} onValueChange={aoEscolher} disabled={mover.isPending}>
      <SelectTrigger
        className={className ?? "h-8 w-auto min-w-[10rem] gap-2 text-xs"}
        aria-label={t("Mover para outra etapa")}
        data-testid="mover-de-etapa"
      >
        <SelectValue placeholder={t("Etapa")} />
      </SelectTrigger>
      <SelectContent>
        {opcoes.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
