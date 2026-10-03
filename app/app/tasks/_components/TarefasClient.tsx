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
import {
  estaAtrasada,
  faixaDePrazo,
  type NovaTarefa,
  type SituacaoDaTarefa,
  type Tarefa,
} from "@/lib/tarefas/tipos";

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

  const filtroResponsavel = responsavel === "todos" ? undefined : responsavel;

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
    ? (responsaveis.find((r) => r.id === emDetalhe.responsible_profile_id)?.name ?? null)
    : null;

  const resumoDaVisao = {
    total: tarefas.length,
    atrasadas: tarefas.filter((tarefa) => estaAtrasada(tarefa)).length,
    hoje: tarefas.filter((tarefa) => faixaDePrazo(tarefa) === "hoje").length,
    semResponsavel: tarefas.filter((tarefa) => !tarefa.responsible_profile_id).length,
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 sm:p-6">
      <header className="relative overflow-hidden rounded-[24px] border border-border/60 bg-gradient-to-br from-card via-card to-muted/35 p-5 shadow-[0_10px_32px_rgba(0,0,0,0.045)] sm:p-6">
        <div
          className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full bg-primary/[0.045] blur-3xl"
          aria-hidden="true"
        />
        <div className="relative flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="mb-2 text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              {t("Execução do time")}
            </p>
            <h1 className="text-2xl font-semibold tracking-[-0.045em] sm:text-[2rem]">
              {t("Tarefas")}
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {t(
                "Fila operacional do time: responsável, prazo, contexto do lead e ação no WhatsApp.",
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {modo !== "kanban" ? (
              <Select value={situacao} onValueChange={(v) => setSituacao(v as FiltroDeSituacao)}>
                <SelectTrigger className="h-9 w-[160px] rounded-xl border-border/60 bg-background/70 text-xs">
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
              <SelectTrigger className="h-9 w-[190px] rounded-xl border-border/60 bg-background/70 text-xs">
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

            <div className="flex items-center gap-0.5 rounded-xl border border-border/60 bg-muted/35 p-1">
              <button
                type="button"
                onClick={() => setModo("lista")}
                aria-pressed={modo === "lista"}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
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
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
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
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
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
              className="h-9 gap-1.5 rounded-xl bg-background/70 text-xs"
              onClick={() => recarregar()}
              disabled={carregando}
            >
              <ArrowsClockwise size={14} className={cn(carregando && "animate-spin")} aria-hidden />
              {t("Atualizar")}
            </Button>

            {podeEditar ? (
              <Button
                size="sm"
                className="h-9 gap-1.5 rounded-xl text-xs"
                onClick={() => abrirNova()}
              >
                <Plus size={14} aria-hidden />
                {t("Nova tarefa")}
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <section
        aria-label={t("Resumo das tarefas")}
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        {[
          { rotulo: t("Nesta visão"), valor: resumoDaVisao.total, alerta: false },
          {
            rotulo: t("Atrasadas"),
            valor: resumoDaVisao.atrasadas,
            alerta: resumoDaVisao.atrasadas > 0,
          },
          { rotulo: t("Vencem hoje"), valor: resumoDaVisao.hoje, alerta: false },
          {
            rotulo: t("Sem responsável"),
            valor: resumoDaVisao.semResponsavel,
            alerta: resumoDaVisao.semResponsavel > 0,
          },
        ].map((item) => (
          <article
            key={item.rotulo}
            className={cn(
              "rounded-2xl border p-4 shadow-sm",
              item.alerta ? "border-amber-500/20 bg-amber-500/[0.035]" : "border-border/60 bg-card",
            )}
          >
            <p className="text-[10px] font-semibold tracking-[0.10em] text-muted-foreground uppercase">
              {item.rotulo}
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.035em] tabular-nums">
              {item.valor}
            </p>
          </article>
        ))}
      </section>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/60 bg-card px-3.5 py-3 shadow-sm">
        <span className="mr-1 text-[10px] font-semibold tracking-[0.10em] text-muted-foreground uppercase">
          {t("Responsável")}
        </span>
        <button
          type="button"
          onClick={() => setResponsavel("todos")}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs transition",
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
              "rounded-full border px-3 py-1.5 text-xs transition",
              responsavel === perfil.id
                ? "border-primary bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {perfil.name}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {tarefas.length} {tarefas.length === 1 ? t("tarefa") : t("tarefas")}
        </span>
      </div>

      {falhou ? (
        <div className="rounded-2xl border border-destructive/25 bg-destructive/[0.035] p-6 text-center">
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
            <div
              key={i}
              className="h-16 animate-pulse rounded-2xl border border-border/60 bg-card"
            />
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
