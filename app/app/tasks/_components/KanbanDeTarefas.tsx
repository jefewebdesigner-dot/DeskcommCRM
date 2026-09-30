"use client";

import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { Clock3 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  PerfilResponsavelTarefa,
  SituacaoDaTarefa,
  Tarefa,
} from "@/lib/tarefas/tipos";

const COLUNAS: Array<{
  status: Extract<SituacaoDaTarefa, "pending" | "in_progress" | "done">;
  titulo: string;
  subtitulo: string;
}> = [
  { status: "pending", titulo: "Pendente", subtitulo: "Ainda não iniciada" },
  { status: "in_progress", titulo: "Em andamento", subtitulo: "Sendo trabalhada agora" },
  { status: "done", titulo: "Concluída", subtitulo: "Ação finalizada" },
];

const PRIORIDADE: Record<Tarefa["priority"], { label: string; variant: "neutral" | "info" | "warning" | "error" }> = {
  low: { label: "Baixa", variant: "neutral" },
  medium: { label: "Média", variant: "info" },
  high: { label: "Alta", variant: "warning" },
  urgent: { label: "Urgente", variant: "error" },
};

function prazo(tarefa: Tarefa): string {
  if (!tarefa.due_date) return "Sem prazo";
  return new Date(tarefa.due_date).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function KanbanDeTarefas({
  tarefas,
  responsaveis,
  podeEditar,
  aoAbrir,
  aoMover,
}: {
  tarefas: Tarefa[];
  responsaveis: PerfilResponsavelTarefa[];
  podeEditar: boolean;
  aoAbrir: (tarefa: Tarefa) => void;
  aoMover: (tarefa: Tarefa, status: SituacaoDaTarefa) => Promise<unknown>;
}) {
  const nomes = new Map(responsaveis.map((r) => [r.id, r.name]));
  const abertas = tarefas.filter((t) => t.status !== "cancelled");

  function terminou(result: DropResult) {
    const { destination, draggableId } = result;
    if (!destination || !podeEditar) return;
    const tarefa = abertas.find((item) => item.id === draggableId);
    if (!tarefa) return;
    const novoStatus = destination.droppableId as SituacaoDaTarefa;
    if (novoStatus === tarefa.status) return;
    void aoMover(tarefa, novoStatus);
  }

  return (
    <DragDropContext onDragEnd={terminou}>
      <div className="grid min-h-[520px] gap-3 lg:grid-cols-3">
        {COLUNAS.map((coluna) => {
          const itens = abertas.filter((tarefa) => tarefa.status === coluna.status);
          return (
            <div
              key={coluna.status}
              className="flex min-h-[480px] flex-col rounded-xl border bg-muted/20"
            >
              <div className="border-b px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold">{coluna.titulo}</h2>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {coluna.subtitulo}
                    </p>
                  </div>
                  <Badge variant="neutral">{itens.length}</Badge>
                </div>
              </div>

              <Droppable droppableId={coluna.status} type="TASK">
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={cn(
                      "flex flex-1 flex-col gap-2 p-2 transition-colors",
                      snapshot.isDraggingOver && "bg-accent/5",
                    )}
                  >
                    {itens.map((tarefa, index) => {
                      const prioridade = PRIORIDADE[tarefa.priority];
                      const responsavel = tarefa.responsible_profile_id
                        ? nomes.get(tarefa.responsible_profile_id)
                        : null;
                      return (
                        <Draggable
                          key={tarefa.id}
                          draggableId={tarefa.id}
                          index={index}
                          isDragDisabled={!podeEditar}
                        >
                          {(drag, dragState) => (
                            <button
                              ref={drag.innerRef}
                              {...drag.draggableProps}
                              {...drag.dragHandleProps}
                              type="button"
                              onClick={() => aoAbrir(tarefa)}
                              className={cn(
                                "rounded-lg border bg-card p-3 text-left shadow-xs transition",
                                "hover:border-border-strong hover:shadow-sm",
                                dragState.isDragging && "rotate-1 shadow-lg",
                              )}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <h3 className="line-clamp-2 text-sm font-medium">
                                  {tarefa.title}
                                </h3>
                                <Badge variant={prioridade.variant} className="shrink-0 px-2">
                                  {prioridade.label}
                                </Badge>
                              </div>

                              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                                {responsavel ? (
                                  <Badge variant="info" className="px-2">
                                    {responsavel}
                                  </Badge>
                                ) : (
                                  <Badge variant="neutral" className="px-2">
                                    Sem responsável
                                  </Badge>
                                )}
                                <span className="inline-flex items-center gap-1 text-muted-foreground">
                                  <Clock3 className="h-3 w-3" />
                                  {prazo(tarefa)}
                                </span>
                              </div>

                              {tarefa.description ? (
                                <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                                  {tarefa.description}
                                </p>
                              ) : null}
                            </button>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                    {itens.length === 0 && !snapshot.isDraggingOver ? (
                      <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
                        Arraste uma tarefa para cá
                      </div>
                    ) : null}
                  </div>
                )}
              </Droppable>
            </div>
          );
        })}
      </div>
    </DragDropContext>
  );
}
