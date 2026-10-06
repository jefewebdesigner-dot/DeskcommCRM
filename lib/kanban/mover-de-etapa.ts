import { midpoint } from "@/lib/kanban/fractional-indexing";
import type { Stage } from "@/lib/kanban/types";
import type { Lead } from "@/lib/types/leads";

/**
 * Posição para colocar um negócio NO FIM de uma etapa, quando a pessoa o move por
 * um controle (seletor, menu) em vez de arrastá-lo. Arrastar sabe entre quais
 * vizinhos soltou; escolher a etapa numa lista não sabe — e "no fim" é o que a
 * pessoa espera: o negócio que acabou de avançar entra depois dos que já estavam.
 */
export function posicaoNoFimDaEtapa(
  leads: { id: string; stage_id: string; position_in_stage: number | null }[],
  stageId: string,
  ignorarLeadId?: string,
): number {
  let ultima: number | null = null;
  for (const l of leads) {
    if (l.stage_id !== stageId || l.id === ignorarLeadId) continue;
    const p = l.position_in_stage;
    if (typeof p === "number" && (ultima === null || p > ultima)) ultima = p;
  }
  return midpoint(ultima, null);
}

/**
 * Etapas oferecidas no seletor "Mover para". Fora: arquivadas e a de PERDIDO —
 * perder um negócio pede o motivo (diálogo de descarte), e um seletor não pergunta.
 * A etapa ATUAL fica sempre, mesmo arquivada ou perdida, para o seletor mostrar
 * onde o negócio está em vez de aparecer vazio.
 */
export function etapasParaMover(stages: Stage[], etapaAtualId: string): Stage[] {
  return stages
    .filter((s) => s.id === etapaAtualId || (!s.is_archived && !s.is_lost))
    .sort((a, b) => a.position - b.position);
}
