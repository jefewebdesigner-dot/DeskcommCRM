"use client";

import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConversaInline } from "@/components/inbox/ConversaInline";
import { useLeadTimeline } from "@/hooks/leads/useLeadTimeline";
import type { Lead } from "@/lib/types/leads";
import type { Stage } from "@/lib/kanban/types";
import { MoverDeEtapa } from "./MoverDeEtapa";
import { LeadFieldsForm } from "./LeadFieldsForm";
import { ScoreSlot } from "./ScoreSlot";
import { LeadTimeline } from "./LeadTimeline";
import { OwnerBadge } from "./OwnerBadge";
import { WhatsAppDoDossie } from "./WhatsAppDoDossie";
import { TarefasDoDossie } from "./TarefasDoDossie";
import { AgendarNoDossie } from "./AgendarNoDossie";
import { resolveLeadOwner } from "@/lib/kanban/owner";
import type { CustomFieldDef } from "@/components/contacts/CustomFieldsEditor";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lead: Lead;
  pipelineId: string;
  fieldDefs?: CustomFieldDef[];
  /** Etapas e negócios do funil: alimentam o seletor "Mover para". */
  stages: Stage[];
  leadsDoFunil: Lead[];
  ownerNames?: Map<string, string | null>;
}

function formatBRL(cents: number | null, currency: string | null): string {
  if (cents === null) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency ?? "BRL",
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `R$ ${(cents / 100).toFixed(0)}`;
  }
}

/**
 * O dossiê do negócio: cabeçalho vivo → timeline → campos.
 *
 * A ORDEM É a mudança em relação ao diálogo de edição: quem abre um lead quer
 * primeiro saber O QUE ACONTECEU, e só depois mexer. O formulário íntegro fica
 * por último, e o cabeçalho tem um atalho para ele — ordem preservada, custo de
 * rolagem resolvido.
 *
 * SALVAR NÃO FECHA. Quem edita precisa ver a atividade que acabou de gerar
 * entrar na timeline; fechar esconderia o registro justamente de quem o
 * produziu, e a funcionalidade que prova "sua ação fica registrada" provaria
 * isso para todo mundo menos para o autor.
 */
export function LeadDossier({
  open,
  onOpenChange,
  lead,
  pipelineId,
  fieldDefs = [],
  stages,
  leadsDoFunil,
  ownerNames,
}: Props) {
  const tagDoIdioma = useTagDeIdioma();
  const t = useT();
  const [aba, setAba] = useState<string>(lead.conversa ? "conversa" : "tarefas");
  const timeline = useLeadTimeline(open ? lead.id : null, lead.contact_id);
  const owner = resolveLeadOwner(lead, ownerNames);
  const score = lead.score ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-xl"
        // Observável pelo mesmo motivo do board: "a assinatura morreu" e "nada
        // aconteceu" têm a mesma aparência, que é silêncio.
        data-realtime-status={timeline.realtimeStatus.toLowerCase()}
        // Observável como no board: "a entrega morreu" e "nada aconteceu"
        // têm a mesma aparência, e no dossiê a segunda é ainda mais crível —
        // negócio sem novidade é um estado normal.
        data-refetch-divergencias={timeline.seguranca.divergencias}
      >
        <SheetHeader className="pb-3">
          <SheetTitle className="text-base leading-6">{lead.title}</SheetTitle>
        </SheetHeader>

        {/* ① cabeçalho vivo */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border pb-3 text-xs">
          <span className="font-medium text-text tabular-nums">
            {formatBRL(lead.value_cents, lead.currency)}
          </span>
          <MoverDeEtapa lead={lead} pipelineId={pipelineId} stages={stages} leads={leadsDoFunil} />
          <OwnerBadge
            ownerKind={owner.kind}
            ownerName={owner.name}
            agentVersion={owner.agentVersion}
          />
          {score && (
            // O MESMO componente do card, não uma cópia do medidor.
            // "Superfície nova herda as decisões da antiga" só vale como
            // mecanismo: herdar por cópia é como as duas listas do evidence —
            // funciona hoje e diverge no mês em que alguém mudar um dos dois.
            // De brinde, o rótulo honesto da âncora ("registro que sustenta",
            // nunca "momento da conversa") vem junto, sem eu reescrever nada.
            <ScoreSlot
              probability={score.probability}
              band={score.band}
              reason={score.reason}
              factors={score.factors.slice(0, 3)}
            />
          )}
        </div>

        {/* O score NÃO aparece na timeline: recálculo é telemetria e não emite
            atividade (silêncio para telemetria, pulso para mudança de estado).
            Sem esta linha, quem visse o número mudando no cabeçalho e nunca na
            timeline concluiria que a timeline está incompleta. */}
        {score?.at && (
          <p className="pt-2 text-[11px] text-text-muted">
            {t("Probabilidade recalculada automaticamente")} ·{" "}
            {new Date(score.at).toLocaleString(tagDoIdioma)}
          </p>
        )}

        {/* As quatro coisas que se faz com um negócio, uma por aba — e a conversa
            primeiro: é o que a pessoa veio fazer. Antes, a conversa era um link para
            outra página e o dossiê era uma rolagem única de cinco blocos. */}
        <Tabs value={aba} onValueChange={setAba} className="flex flex-1 flex-col pt-3">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="conversa" className="gap-1.5">
              {t("Conversa")}
              {lead.conversa && lead.conversa.unread > 0 ? (
                <span
                  className="rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground tabular-nums"
                  aria-label={`${lead.conversa.unread} ${t("sem ler")}`}
                >
                  {lead.conversa.unread}
                </span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="tarefas">{t("Tarefas")}</TabsTrigger>
            <TabsTrigger value="historico">{t("Histórico")}</TabsTrigger>
            <TabsTrigger value="dados">{t("Dados")}</TabsTrigger>
          </TabsList>

          <TabsContent value="conversa" className="mt-3 space-y-2">
            {lead.conversa ? (
              <ConversaInline conversationId={lead.conversa.id} />
            ) : (
              // Sem conversa ainda: o envio abaixo ABRE uma e, quando abrir, o
              // negócio passa a ter a conversa inteira nesta aba.
              <WhatsAppDoDossie lead={lead} pipelineId={pipelineId} />
            )}
          </TabsContent>

          <TabsContent value="tarefas" className="mt-3 space-y-2">
            <TarefasDoDossie lead={lead} />
            <AgendarNoDossie lead={lead} pipelineId={pipelineId} />
          </TabsContent>

          <TabsContent value="historico" className="mt-3">
            <LeadTimeline
              itens={timeline.itens}
              chegouAoVivo={timeline.chegouAoVivo}
              isLoading={timeline.isLoading}
              isError={timeline.isError}
            />
          </TabsContent>

          <TabsContent value="dados" className="mt-3">
            <LeadFieldsForm lead={lead} pipelineId={pipelineId} fieldDefs={fieldDefs} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
