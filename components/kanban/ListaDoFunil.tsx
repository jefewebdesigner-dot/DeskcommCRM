"use client";

import { useMemo, useState } from "react";
import { CalendarClock, ChevronDown, ChevronRight, ListTodo, MessageCircle } from "lucide-react";

import { useT } from "@/hooks/i18n/useT";
import { formatCents } from "@/lib/money";
import { haQuantoTempo, ordenarParaAtendimento } from "@/lib/kanban/lista-do-funil";
import { resolveLeadOwner } from "@/lib/kanban/owner";
import type { Stage } from "@/lib/kanban/types";
import type { Lead } from "@/lib/types/leads";
import { MoverDeEtapa } from "./MoverDeEtapa";

/** Linhas mostradas por etapa antes do "Mostrar mais": 300 linhas de uma vez não se leem. */
const LINHAS_POR_ETAPA = 20;

/**
 * O funil como LISTA DE TRABALHO: uma linha por negócio, agrupada por etapa, com
 * o que importa para agir — quem é, o que foi dito por último, qual o próximo
 * passo, de quem é — e a etapa trocável ali mesmo.
 *
 * O quadro mostra o funil como mapa; esta tela o mostra como fila. Quem atende
 * cliente o dia inteiro precisa da fila: ver tudo sem arrastar, com o que
 * precisa de ação no topo (ordem em `ordenarParaAtendimento`).
 *
 * Clicar na linha abre o MESMO dossiê do quadro — com a conversa dentro — então
 * ler, responder e mudar a etapa acontecem sem sair daqui.
 */
export function ListaDoFunil({
  stages,
  leads,
  pipelineId,
  ownerNames,
  onOpen,
}: {
  stages: Stage[];
  leads: Lead[];
  pipelineId: string;
  ownerNames?: Map<string, string | null>;
  onOpen: (leadId: string) => void;
}) {
  const t = useT();
  const [fechadas, setFechadas] = useState<Set<string>>(new Set());
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());

  const etapas = useMemo(
    () => [...stages].filter((s) => !s.is_archived).sort((a, b) => a.position - b.position),
    [stages],
  );
  const porEtapa = useMemo(() => {
    const mapa = new Map<string, Lead[]>();
    for (const s of etapas) mapa.set(s.id, []);
    for (const l of leads) mapa.get(l.stage_id)?.push(l);
    for (const [id, lista] of mapa) mapa.set(id, ordenarParaAtendimento(lista));
    return mapa;
  }, [etapas, leads]);

  function alternar(conjunto: Set<string>, id: string, definir: (s: Set<string>) => void) {
    const proximo = new Set(conjunto);
    if (proximo.has(id)) proximo.delete(id);
    else proximo.add(id);
    definir(proximo);
  }

  return (
    <div className="space-y-3" data-testid="lista-do-funil">
      {etapas.map((etapa) => {
        const lista = porEtapa.get(etapa.id) ?? [];
        const aberta = !fechadas.has(etapa.id);
        const todas = expandidas.has(etapa.id);
        const visiveis = todas ? lista : lista.slice(0, LINHAS_POR_ETAPA);
        const total = lista.reduce((soma, l) => soma + (l.value_cents ?? 0), 0);
        return (
          <section
            key={etapa.id}
            className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm"
          >
            <button
              type="button"
              onClick={() => alternar(fechadas, etapa.id, setFechadas)}
              aria-expanded={aberta}
              className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/40"
            >
              {aberta ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="text-sm font-semibold">{etapa.name}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground tabular-nums">
                {lista.length}
              </span>
              {total > 0 ? (
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {formatCents(total, "BRL")}
                </span>
              ) : null}
            </button>

            {aberta ? (
              lista.length === 0 ? (
                <p className="border-t border-border/50 px-4 py-3 text-xs text-muted-foreground">
                  {t("Nenhum negócio nesta etapa.")}
                </p>
              ) : (
                <ul className="divide-y divide-border/50 border-t border-border/50">
                  {visiveis.map((lead) => (
                    <LinhaDoNegocio
                      key={lead.id}
                      lead={lead}
                      pipelineId={pipelineId}
                      stages={stages}
                      leads={leads}
                      ownerNames={ownerNames}
                      onOpen={onOpen}
                    />
                  ))}
                  {lista.length > visiveis.length ? (
                    <li className="px-4 py-2">
                      <button
                        type="button"
                        onClick={() => alternar(expandidas, etapa.id, setExpandidas)}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        {t("Mostrar mais")} ({lista.length - visiveis.length})
                      </button>
                    </li>
                  ) : null}
                </ul>
              )
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function LinhaDoNegocio({
  lead,
  pipelineId,
  stages,
  leads,
  ownerNames,
  onOpen,
}: {
  lead: Lead;
  pipelineId: string;
  stages: Stage[];
  leads: Lead[];
  ownerNames?: Map<string, string | null>;
  onOpen: (leadId: string) => void;
}) {
  const t = useT();
  const dono = resolveLeadOwner(lead, ownerNames);
  const conversa = lead.conversa;
  const quando = haQuantoTempo(conversa?.last_message_at);
  const proximo = lead.next_operation;

  return (
    <li className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <button
        type="button"
        onClick={() => onOpen(lead.id)}
        className="min-w-0 rounded-md text-left outline-offset-4 hover:bg-muted/30"
        aria-label={`${t("Abrir")} ${lead.title}`}
      >
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{lead.title}</span>
          {conversa && conversa.unread > 0 ? (
            <span
              className="shrink-0 rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground tabular-nums"
              aria-label={`${conversa.unread} ${t("sem ler")}`}
            >
              {conversa.unread}
            </span>
          ) : null}
        </span>
        {conversa?.preview ? (
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MessageCircle className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{conversa.preview}</span>
            {quando ? <span className="shrink-0 tabular-nums">· {quando}</span> : null}
          </span>
        ) : (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {t("Sem conversa ainda")}
          </span>
        )}
        {proximo ? (
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {proximo.kind === "appointment" ? (
              <CalendarClock className="h-3 w-3 shrink-0 text-primary" aria-hidden />
            ) : (
              <ListTodo className="h-3 w-3 shrink-0 text-primary" aria-hidden />
            )}
            <span className="truncate">{proximo.label}</span>
            {proximo.at ? (
              <span className="shrink-0 tabular-nums">
                ·{" "}
                {new Intl.DateTimeFormat("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(proximo.at))}
              </span>
            ) : null}
          </span>
        ) : null}
      </button>

      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {dono.name ? (
          <span className="max-w-[8rem] truncate text-xs text-muted-foreground" title={dono.name}>
            {dono.name}
          </span>
        ) : (
          <span className="text-xs text-amber-600 dark:text-amber-400">{t("Sem responsável")}</span>
        )}
        <MoverDeEtapa lead={lead} pipelineId={pipelineId} stages={stages} leads={leads} />
      </div>
    </li>
  );
}
