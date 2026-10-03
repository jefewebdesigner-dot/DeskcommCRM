"use client";

import Link from "next/link";
import { addDays, format, isBefore, isSameDay } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { ArrowRight, CalendarBlank, ClockCountdown, Warning } from "@/lib/ui/icons";

import type { Agendamento } from "./tipos";

type MotivoDaPrioridade =
  "confirmacao_vencida" | "resultado_pendente" | "aguardando_confirmacao" | "hoje";

export type PrioridadeDaAgenda = {
  agendamento: Agendamento;
  motivo: MotivoDaPrioridade;
};

export function resumirAgendaOperacional(agendamentos: Agendamento[], agora: Date) {
  const nossos = agendamentos.filter(
    (a) =>
      a.origem !== "google_sync" &&
      a.situacao !== "cancelled" &&
      a.situacao !== "completed" &&
      a.situacao !== "no_show",
  );
  const daquiASeteDias = addDays(agora, 7);
  const hoje = nossos.filter((a) => isSameDay(new Date(a.comeca), agora)).length;
  const proximosSeteDias = nossos.filter((a) => {
    const inicio = new Date(a.comeca);
    return !isBefore(inicio, agora) && isBefore(inicio, daquiASeteDias);
  }).length;
  const semConfirmacao = nossos.filter((a) => a.situacao === "pending").length;
  const atrasados = nossos.filter((a) => isBefore(new Date(a.termina), agora)).length;

  const prioridades: PrioridadeDaAgenda[] = nossos
    .map((agendamento): PrioridadeDaAgenda | null => {
      const terminou = isBefore(new Date(agendamento.termina), agora);
      const ehHoje = isSameDay(new Date(agendamento.comeca), agora);
      if (terminou && agendamento.situacao === "pending") {
        return { agendamento, motivo: "confirmacao_vencida" };
      }
      if (terminou && agendamento.situacao === "confirmed") {
        return { agendamento, motivo: "resultado_pendente" };
      }
      if (agendamento.situacao === "pending") {
        return { agendamento, motivo: "aguardando_confirmacao" };
      }
      if (ehHoje) return { agendamento, motivo: "hoje" };
      return null;
    })
    .filter((item): item is PrioridadeDaAgenda => item !== null)
    .sort((a, b) => {
      const ordem: Record<MotivoDaPrioridade, number> = {
        confirmacao_vencida: 0,
        resultado_pendente: 1,
        aguardando_confirmacao: 2,
        hoje: 3,
      };
      return (
        ordem[a.motivo] - ordem[b.motivo] ||
        Date.parse(a.agendamento.comeca) - Date.parse(b.agendamento.comeca)
      );
    });

  return { hoje, proximosSeteDias, semConfirmacao, atrasados, prioridades };
}

const ROTULO: Record<MotivoDaPrioridade, string> = {
  confirmacao_vencida: "Horário passou sem confirmação",
  resultado_pendente: "Registrar resultado do compromisso",
  aguardando_confirmacao: "Aguardando confirmação",
  hoje: "Compromisso de hoje",
};

export function ResumoOperacionalDaAgenda({
  agendamentos,
  agora,
  onAbrirAgendamento,
}: {
  agendamentos: Agendamento[];
  agora: Date;
  onAbrirAgendamento: (id: string) => void;
}) {
  const t = useT();
  const locale = useLocaleDeData();
  const resumo = resumirAgendaOperacional(agendamentos, agora);
  const cards = [
    { titulo: "Hoje", valor: resumo.hoje, ajuda: "Compromissos ativos no dia.", destaque: false },
    {
      titulo: "Próximos 7 dias",
      valor: resumo.proximosSeteDias,
      ajuda: "O que já está marcado para a semana.",
      destaque: false,
    },
    {
      titulo: "Pendências atrasadas",
      valor: resumo.atrasados,
      ajuda: "Horários passados ainda sem desfecho.",
      destaque: resumo.atrasados > 0,
    },
    {
      titulo: "Sem confirmação",
      valor: resumo.semConfirmacao,
      ajuda: "Pedidos que ainda precisam de confirmação.",
      destaque: resumo.semConfirmacao > 0,
    },
  ];

  return (
    <section
      aria-label={t("Agenda executiva")}
      className="space-y-3"
      data-testid="agenda-executiva"
    >
      <div>
        <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          {t("Visão operacional")}
        </p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight">{t("Meu dia")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t(
            "O que precisa acontecer agora para nenhum cliente ou compromisso ficar sem próximo passo.",
          )}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.titulo}
            className={
              card.destaque
                ? "rounded-2xl border border-warning/20 bg-warning-bg/30 p-4 shadow-sm"
                : "rounded-2xl border border-border/60 bg-card p-4 shadow-sm"
            }
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-semibold tracking-[0.09em] text-muted-foreground uppercase">
                {t(card.titulo)}
              </p>
              <CalendarBlank size={16} className="text-muted-foreground" aria-hidden />
            </div>
            <p className="mt-3 text-2xl font-semibold tracking-[-0.035em] tabular-nums">
              {card.valor}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{t(card.ajuda)}</p>
          </div>
        ))}
      </div>

      {resumo.prioridades.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-warning/20 bg-card shadow-sm">
          <div className="flex items-center gap-2 border-b border-border/60 bg-warning-bg/25 px-4 py-3">
            <Warning size={16} className="text-warning-fg" aria-hidden />
            <p className="text-sm font-medium">{t("Prioridades da agenda")}</p>
            <Badge variant="warning" className="ml-auto">
              {resumo.prioridades.length}
            </Badge>
          </div>
          <ul className="divide-y divide-border">
            {resumo.prioridades.slice(0, 6).map(({ agendamento, motivo }) => (
              <li
                key={agendamento.id}
                className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-muted/25 sm:flex-row sm:items-center"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onAbrirAgendamento(agendamento.id)}
                >
                  <p className="truncate text-sm font-medium">
                    {agendamento.quemSeraAtendido ?? agendamento.titulo}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{t(ROTULO[motivo])}</span>
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <ClockCountdown size={12} aria-hidden />
                      {format(new Date(agendamento.comeca), "dd/MM · HH:mm", { locale })}
                    </span>
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  {agendamento.conversaId ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/app/inbox?id=${agendamento.conversaId}`}>
                        {t("Abrir conversa")}
                      </Link>
                    </Button>
                  ) : agendamento.contatoId ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/app/contacts/${agendamento.contatoId}`}>
                        {t("Abrir contato")}
                      </Link>
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onAbrirAgendamento(agendamento.id)}
                  >
                    {t("Ver compromisso")}
                    <ArrowRight size={14} aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.025] p-4 text-sm text-muted-foreground">
          {t("Nenhuma pendência operacional na agenda agora.")}
        </div>
      )}
    </section>
  );
}
