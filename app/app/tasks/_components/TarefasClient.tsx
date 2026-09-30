"use client";

import { useEffect, useState } from "react";
import { Columns3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { useTaskResponsibles } from "@/hooks/tasks/useTaskResponsibles";
import { useTasks } from "@/hooks/tasks/useTasks";
import { ArrowsClockwise, CalendarBlank, ListChecks, Plus } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import type { NovaTarefa, SituacaoDaTarefa, Tarefa } from "@/lib/tarefas/tipos";

import { CalendarioDeTarefas } from "./CalendarioDeTarefas";
import { DetalheDaTarefa } from "./DetalheDaTarefa";
import { FormularioDeTarefa } from "./FormularioDeTarefa";
import { KanbanDeTarefas } from "./KanbanDeTarefas";
import { ListaDeTarefas } from "./ListaDeTarefas";

type FiltroDeSituacao = "aberto" | SituacaoDaTarefa;
type Modo = "lista" | "kanban" | "calendario";

const CHAVE_RESPONSAVEL = "crm-tasks-working-profile";

export function TarefasClient({ podeEditar }: { podeEditar: boolean }) {
  const t = useT();
  const [modo, setModo] = useState<Modo>("lista");
  const [situacao, setSituacao] = useState<FiltroDeSituacao>("aberto");
  const [responsavel, setResponsavel] = useState("todos");
  const [emEdicao, setEmEdicao] = useState<Tarefa | null>(null);
  const [emDetalhe, setEmDetalhe] = useState<Tarefa | null>(null);
  const [formAberto, setFormAberto] = useState(false);
  const [prazoSugerido, setPrazoSugerido] = useState<string | undefined>();
  const [aberturas, setAberturas] = useState(0);

  const responsaveisQuery = useTaskResponsibles();
  const responsaveis = responsaveisQuery.data ?? [];

  useEffect(() => {
    const salvo = window.localStorage.getItem(CHAVE_RESPONSAVEL);
    if (salvo) queueMicrotask(() => setResponsavel(salvo));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(CHAVE_RESPONSAVEL, responsavel);
  }, [responsavel]);

  const filtroResponsavel =
    responsavel === "todos" ? undefined : responsavel;

  const {
    tarefas,
    carregando,
    falhou,
    recarregar,
    criarTarefa,
    editarTarefa,
    apagarTarefa,
    alternarConcluida,
  } = useTasks(
    modo === "kanban"
      ? { responsible_profile_id: filtroResponsavel }
      : situacao === "aberto"
        ? { aberto: true, responsible_profile_id: filtroResponsavel }
        : { status: situacao, responsible_profile_id: filtroResponsavel },
  );

  function abrirNova(dia?: string) {
    setEmEdicao(null);
    setPrazoSugerido(dia);
    setAberturas((n) => n + 1);
    setFormAberto(true);
  }

  function abrirEdicao(tarefa: Tarefa) {
    setEmEdicao(tarefa);
    setPrazoSugerido(undefined);
    setAberturas((n) => n + 1);
    setFormAberto(true);
  }

  async function salvar(entrada: NovaTarefa) {
    if (emEdicao) await editarTarefa(emEdicao.id, entrada);
    else await criarTarefa(entrada);
  }

  async function mover(tarefa: Tarefa, status: SituacaoDaTarefa) {
    await editarTarefa(tarefa.id, { status });
  }

  const nomeResponsavelDoDetalhe = emDetalhe?.responsible_profile_id
    ? responsaveis.find((r) => r.id === emDetalhe.responsible_profile_id)?.name ?? null
    : null;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Tarefas")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Fila operacional do time: responsável, prazo, contexto do lead e ação no WhatsApp.",
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {modo !== "kanban" ? (
            <Select
              value={situacao}
              onValueChange={(v) => setSituacao(v as FiltroDeSituacao)}
            >
              <SelectTrigger className="h-9 w-[160px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aberto">{t("Em aberto")}</SelectItem>
                <SelectItem value="pending">{t("Pendente")}</SelectItem>
                <SelectItem value="in_progress">{t("Em andamento")}</SelectItem>
                <SelectItem value="done">{t("Concluída")}</SelectItem>
                <SelectItem value="cancelled">{t("Cancelada")}</SelectItem>
              </SelectContent>
            </Select>
          ) : null}

          <Select value={responsavel} onValueChange={setResponsavel}>
            <SelectTrigger className="h-9 w-[190px] text-xs">
              <SelectValue placeholder={t("Responsável")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">{t("Todos os responsáveis")}</SelectItem>
              {responsaveis.map((perfil) => (
                <SelectItem key={perfil.id} value={perfil.id}>
                  {perfil.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-0.5 rounded-md border bg-muted p-0.5">
            <button
              type="button"
              onClick={() => setModo("lista")}
              aria-pressed={modo === "lista"}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                modo === "lista"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <ListChecks size={14} aria-hidden />
              {t("Lista")}
            </button>
            <button
              type="button"
              onClick={() => setModo("kanban")}
              aria-pressed={modo === "kanban"}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                modo === "kanban"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Columns3 className="h-3.5 w-3.5" aria-hidden />
              {t("Kanban")}
            </button>
            <button
              type="button"
              onClick={() => setModo("calendario")}
              aria-pressed={modo === "calendario"}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                modo === "calendario"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <CalendarBlank size={14} aria-hidden />
              {t("Calendário")}
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-xs"
            onClick={() => recarregar()}
            disabled={carregando}
          >
            <ArrowsClockwise
              size={14}
              className={cn(carregando && "animate-spin")}
              aria-hidden
            />
            {t("Atualizar")}
          </Button>

          {podeEditar ? (
            <Button size="sm" className="h-9 gap-1.5 text-xs" onClick={() => abrirNova()}>
              <Plus size={14} aria-hidden />
              {t("Nova tarefa")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-3">
        <span className="text-xs font-medium text-muted-foreground">
          {t("Trabalhando como:")}
        </span>
        <button
          type="button"
          onClick={() => setResponsavel("todos")}
          className={cn(
            "rounded-full border px-3 py-1 text-xs transition",
            responsavel === "todos"
              ? "border-primary bg-primary/10 font-medium text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t("Todos")}
        </button>
        {responsaveis.map((perfil) => (
          <button
            key={perfil.id}
            type="button"
            onClick={() => setResponsavel(perfil.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition",
              responsavel === perfil.id
                ? "border-primary bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {perfil.name}
          </button>
        ))}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {tarefas.length} {tarefas.length === 1 ? t("tarefa") : t("tarefas")}
        </span>
      </div>

      {falhou ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
          <p className="text-sm font-medium text-destructive">
            {t("Não foi possível carregar as tarefas.")}
          </p>
          <Button variant="outline" size="sm" className="mt-3 text-xs" onClick={() => recarregar()}>
            {t("Tentar novamente")}
          </Button>
        </div>
      ) : carregando || responsaveisQuery.isLoading ? (
        <div className="space-y-3" aria-busy>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg border bg-card" />
          ))}
        </div>
      ) : modo === "calendario" ? (
        <CalendarioDeTarefas
          tarefas={tarefas}
          podeEditar={podeEditar}
          aoAbrirTarefa={(tarefa) => setEmDetalhe(tarefa)}
          aoClicarNoDia={abrirNova}
        />
      ) : modo === "kanban" ? (
        <KanbanDeTarefas
          tarefas={tarefas}
          responsaveis={responsaveis}
          podeEditar={podeEditar}
          aoAbrir={setEmDetalhe}
          aoMover={mover}
        />
      ) : (
        <ListaDeTarefas
          tarefas={tarefas}
          responsaveis={responsaveis}
          podeEditar={podeEditar}
          aoAlternarConcluida={alternarConcluida}
          aoEditar={abrirEdicao}
          aoApagar={(tarefa) => apagarTarefa(tarefa.id)}
          aoAbrirDetalhe={setEmDetalhe}
        />
      )}

      <FormularioDeTarefa
        key={aberturas}
        aberto={formAberto}
        aoMudarAbertura={setFormAberto}
        tarefa={emEdicao}
        prazoSugerido={prazoSugerido}
        aoSalvar={salvar}
        responsaveis={responsaveis}
        responsavelPadraoId={filtroResponsavel}
      />

      <DetalheDaTarefa
        key={emDetalhe?.id ?? "sem-detalhe"}
        tarefa={emDetalhe}
        responsavel={nomeResponsavelDoDetalhe}
        aberto={Boolean(emDetalhe)}
        aoMudarAbertura={(aberto) => {
          if (!aberto) setEmDetalhe(null);
        }}
        aoConcluir={(tarefa) => editarTarefa(tarefa.id, { status: "done" })}
      />
    </div>
  );
}
