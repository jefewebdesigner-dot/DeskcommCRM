"use client";
import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useT } from "@/hooks/i18n/useT";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useClaimConversation } from "@/hooks/inbox/useClaimConversation";
import { useAtRiskLeads, type AtRiskLead } from "@/hooks/leads/useAtRiskLeads";
import type { RiskBucket } from "@/lib/leads/risk-radar";
import { ArrowRight, CheckCircle, ClockCountdown, PaperPlaneTilt, Warning } from "@/lib/ui/icons";

const PAGE_SIZE = 50;
type RiskFilter = "all" | Exclude<RiskBucket, "em_dia">;
type OwnershipFilter = "all" | "unassigned" | "owned";

const RISK_META: Record<
  Exclude<RiskBucket, "em_dia">,
  { label: string; variant: "error" | "warning" | "info" }
> = {
  critico: { label: "Crítico", variant: "error" },
  em_risco: { label: "Em risco", variant: "warning" },
  em_voo: { label: "Em voo", variant: "info" },
};

function coldFor(hours: number, t: (texto: string) => string): string {
  if (hours < 48) return `${t("parado há")} ${hours}h`;
  return `${t("parado há")} ${Math.round(hours / 24)}d`;
}

function followupWhen(iso: string, t: (texto: string) => string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return t("agora");
  const hours = Math.round(diffMs / 3_600_000);
  if (hours < 48) return `${t("em")} ${Math.max(1, hours)}h`;
  return `${t("em")} ${Math.round(hours / 24)}d`;
}

export function RiskRadarList() {
  const t = useT();
  const [page, setPage] = useState(0);
  const [risk, setRisk] = useState<RiskFilter>("all");
  const [ownership, setOwnership] = useState<OwnershipFilter>("all");
  const { data, isLoading } = useAtRiskLeads({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    risk: risk === "all" ? undefined : risk,
    ownership,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
        <Skeleton className="h-14 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
      </div>
    );
  }

  // O vazio só é vazio se as DUAS listas estiverem vazias. Sem esta condição,
  // uma organização com 8 demandas sem próximo passo e nenhum lead frio veria
  // "Nenhuma demanda em risco" — escondendo exatamente o vazamento que o
  // invariante 4 existe para denunciar.
  const semPasso = data?.sem_proximo_passo ?? [];
  const totalGlobal = data ? data.counts.critico + data.counts.em_risco + data.counts.em_voo : 0;
  if (!data || (totalGlobal === 0 && semPasso.length === 0)) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-2 rounded-[24px] border border-dashed border-border/60 bg-muted/[0.08] px-6 py-16 text-center"
        data-testid="radar-empty"
      >
        <span
          className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-success-bg text-success-fg"
          aria-hidden="true"
        >
          <CheckCircle size={23} weight="duotone" />
        </span>
        <p className="text-sm font-semibold tracking-tight">{t("Nenhuma demanda em risco")}</p>
        <p className="text-xs text-muted-foreground">
          {t("Toda demanda aberta teve atividade recente ou já tem um retorno agendado.")}
        </p>
      </div>
    );
  }

  const firstVisible = data.total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastVisible = page * PAGE_SIZE + data.items.length;
  const hasPrevious = page > 0;
  const hasNext = lastVisible < data.total;

  const trocarRisco = (next: RiskFilter) => {
    setRisk(next);
    setPage(0);
  };
  const trocarResponsavel = (next: OwnershipFilter) => {
    setOwnership(next);
    setPage(0);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* INVARIANTE 4 em forma acionável: o índice de atrito publica a CONTAGEM
          ("N demandas abertas sem próximo passo"); contagem sem lugar para agir
          viola o invariante 5. Esta é a lista que responde "e daí?". */}
      {page === 0 && semPasso.length > 0 ? (
        <section
          className="border-warning-border/70 overflow-hidden rounded-2xl border bg-warning-bg/35 shadow-sm"
          data-testid="radar-sem-proximo-passo"
        >
          <div className="border-warning-border/50 flex items-start gap-3 border-b px-4 py-3.5">
            <span
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning-fg"
              aria-hidden="true"
            >
              <Warning size={17} weight="duotone" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-tight">
                {semPasso.length}{" "}
                {semPasso.length === 1
                  ? t("demanda aberta sem próximo passo")
                  : t("demandas abertas sem próximo passo")}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t("Defina o que acontece a seguir antes que essas oportunidades esfriem.")}
              </p>
            </div>
          </div>
          <ul className="flex flex-col gap-1 p-2">
            {semPasso.slice(0, 8).map((d) => {
              const href = d.conversation_id
                ? `/app/inbox?id=${d.conversation_id}`
                : d.contact_id
                  ? `/app/contacts/${d.contact_id}`
                  : "/app/kanban";
              return (
                <li key={d.id}>
                  <Link
                    href={href}
                    className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-xs transition-colors hover:bg-background/80"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {d.contact_name ?? t("Contato sem nome")}
                      </span>
                      <span className="text-muted-foreground">
                        {t("Sem próximo passo definido")}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-muted-foreground tabular-nums">
                      {t("aberta há")} {d.horas_aberta}h
                      <ArrowRight size={14} aria-hidden />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section
        className="grid gap-3 sm:grid-cols-3"
        data-testid="radar-counts"
        aria-label={t("Resumo do risco")}
      >
        {[
          {
            label: t("Críticos"),
            value: data.counts.critico,
            helper: t("precisam de ação agora"),
            tone: "error",
          },
          {
            label: t("Em risco"),
            value: data.counts.em_risco,
            helper: t("estão esfriando"),
            tone: "warning",
          },
          {
            label: t("Em voo"),
            value: data.counts.em_voo,
            helper: t("já têm retorno programado"),
            tone: "info",
          },
        ].map((item) => (
          <div
            key={item.label}
            className={
              "min-w-0 rounded-2xl border p-3 shadow-sm sm:p-4 " +
              (item.tone === "error"
                ? "border-error-fg/15 bg-error-bg/25"
                : item.tone === "warning"
                  ? "border-warning-border/60 bg-warning-bg/25"
                  : "border-info-fg/15 bg-info-bg/20")
            }
          >
            <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              {item.label}
            </p>
            <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
              <p className="text-2xl font-semibold tracking-[-0.04em] tabular-nums">{item.value}</p>
              <p className="text-[10px] leading-snug text-muted-foreground sm:text-right sm:text-[11px]">
                {item.helper}
              </p>
            </div>
          </div>
        ))}
      </section>

      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card p-2.5 shadow-sm"
        data-testid="radar-filtros"
      >
        <div className="-mx-1 flex max-w-full flex-nowrap gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(
            [
              ["all", "Todos"],
              ["critico", "Críticos"],
              ["em_risco", "Em risco"],
              ["em_voo", "Em voo"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={risk === value ? "default" : "ghost"}
              className="h-8 shrink-0 rounded-lg px-3 text-[11px]"
              onClick={() => trocarRisco(value)}
              aria-pressed={risk === value}
            >
              {t(label)}
            </Button>
          ))}
        </div>

        <div className="-mx-1 flex max-w-full flex-nowrap gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(
            [
              ["all", "Todos os responsáveis"],
              ["unassigned", "Sem dono"],
              ["owned", "Com responsável"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={ownership === value ? "default" : "ghost"}
              className="h-8 shrink-0 rounded-lg px-3 text-[11px]"
              onClick={() => trocarResponsavel(value)}
              aria-pressed={ownership === value}
            >
              {t(label)}
            </Button>
          ))}
        </div>
      </div>

      {data.items.length > 0 ? (
        <ul className="space-y-2">
          {data.items.map((lead) => (
            <RadarRow key={lead.id} lead={lead} />
          ))}
        </ul>
      ) : (
        <div
          className="rounded-2xl border border-dashed border-border/60 bg-muted/[0.06] px-4 py-12 text-center text-sm text-muted-foreground"
          data-testid="radar-filter-empty"
        >
          {t("Nenhum negócio corresponde a este filtro.")}
        </div>
      )}

      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/50 bg-muted/[0.08] px-3 py-2.5 text-xs text-muted-foreground"
        data-testid="radar-pagination"
      >
        <span>
          {t("Mostrando")} {firstVisible}–{lastVisible} {t("de")} {data.total}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!hasPrevious}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            {t("Anterior")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!hasNext}
            onClick={() => setPage((current) => current + 1)}
          >
            {t("Próxima")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RadarRow({ lead }: { lead: AtRiskLead }) {
  const t = useT();
  const meta = RISK_META[lead.risk as Exclude<RiskBucket, "em_dia">] ?? RISK_META.em_risco;
  const href = lead.conversation_id
    ? `/app/inbox?id=${lead.conversation_id}`
    : `/app/pipelines/${lead.pipeline_id}`;

  const claim = useClaimConversation();
  const qc = useQueryClient();

  // Dono do NEGÓCIO — humano OU agente (0070). Antes desta linha o radar lia só
  // `owner_user_id`, então um lead que a IA trabalha há dezenas de turnos aparecia
  // como "Sem dono" e mandava um humano resgatar o que já estava sendo tocado.
  // A distinção é a MESMA do card (OwnerBadge): geométrica, nunca ícone de robô —
  // uma fonte de verdade para "quem é o dono", em todas as telas.
  const dono =
    lead.owner_kind === "ai"
      ? `${t("Agente:")} ${lead.owner_agent_name ?? t("sem nome")}`
      : lead.owner_user_id || lead.assignee_kind === "user"
        ? t("Com atendente")
        : lead.assignee_kind === "ai"
          ? t("Assistente na conversa")
          : t("Sem dono");

  // "Assumir" é tirar da IA e trazer para si: continua valendo enquanto não há
  // dono HUMANO — dono agente não bloqueia o handoff, é justamente o caso dele.
  const ownedByHuman = Boolean(lead.owner_user_id) || lead.assignee_kind === "user";
  const canClaim = Boolean(lead.conversation_id) && !ownedByHuman;

  function handleClaim() {
    if (!lead.conversation_id) return;
    claim.mutate(
      { conversation_id: lead.conversation_id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["leads-at-risk"] });
          toast.success(t("Você assumiu a demanda"));
        },
      },
    );
  }

  return (
    <li
      data-testid="radar-item"
      data-risk={lead.risk}
      className="flex flex-col rounded-2xl border border-border/60 bg-card shadow-sm transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md sm:flex-row sm:items-start sm:pr-3"
    >
      <Link href={href} className="flex min-w-0 flex-1 items-start gap-3 px-4 pt-3.5 pb-2 sm:py-3.5">
        <Badge variant={meta.variant} className="mt-0.5 shrink-0">
          {t(meta.label)}
        </Badge>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-[-0.01em]">{lead.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {lead.contact_name ? <span className="truncate">{lead.contact_name}</span> : null}
            <span className="inline-flex items-center gap-1">
              <ClockCountdown size={13} aria-hidden />
              {coldFor(lead.hours_since_activity, t)}
            </span>
            <span className="inline-flex items-center gap-1" data-testid="radar-assignee">
              {dono}
            </span>
          </p>
          {lead.agenda?.appointment_id ? (
            <p className="mt-1 text-xs text-info-fg">
              {t(
                lead.agenda.motivo === "presenca_vencida"
                  ? "Presença não confirmada · revise o compromisso"
                  : lead.agenda.motivo === "presenca_pendente"
                    ? "Confirme a presença · cobrança aguardando"
                    : "Compromisso agendado · cobrança aguardando",
              )}
            </p>
          ) : lead.in_flight && lead.next_followup_at ? (
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-info-fg">
              <PaperPlaneTilt size={13} aria-hidden />
              {t("Assistente retorna")} {followupWhen(lead.next_followup_at, t)}
            </p>
          ) : (
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-warning-fg">
              <Warning size={13} aria-hidden />
              {t("Sem próximo passo agendado")}
            </p>
          )}
        </div>
      </Link>
      <div className="flex w-full shrink-0 items-center justify-end gap-2 border-t border-border/50 px-4 py-2.5 sm:w-auto sm:self-center sm:border-t-0 sm:px-0 sm:py-0">
        {lead.agenda?.appointment_id ? (
          <Link
            className="text-xs underline"
            href={`/app/agenda?compromisso=${lead.agenda.appointment_id}`}
          >
            {t("Ver compromisso")}
          </Link>
        ) : null}
        {canClaim ? (
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl"
            disabled={claim.isPending}
            onClick={handleClaim}
            data-testid="radar-claim"
          >
            {t("Assumir")}
          </Button>
        ) : null}
        <ArrowRight size={16} className="text-muted-foreground" aria-hidden />
      </div>
    </li>
  );
}
