"use client";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/hooks/i18n/useT";
import { useBoard } from "@/hooks/kanban/useBoard";
import { useAtRiskLeads } from "@/hooks/leads/useAtRiskLeads";

function formatError(err: unknown, t: (texto: string) => string): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const obj = err as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    if (typeof obj.message === "string") {
      const code = typeof obj.code === "string" ? ` [${obj.code}]` : "";
      return `${obj.message}${code}`;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return t("Erro desconhecido");
    }
  }
  return String(err);
}
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { FilterBar } from "@/components/kanban/FilterBar";
import { ResumoOperacionalDoFunil } from "@/components/kanban/ResumoOperacionalDoFunil";
import { BulkActionBar } from "@/components/kanban/BulkActionBar";
import { NewLeadDialog } from "@/components/kanban/NewLeadDialog";
import { Button } from "@/components/ui/button";
import { Plus } from "@/lib/ui/icons";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  rotuloDoTipoOperacional,
  tipoOperacionalDoFunil,
} from "@/lib/pipelines/funis-operacionais";
import type { LeadFilters } from "@/lib/kanban/filters";
import { applyFilters, filtersFromParams, filtersToParams } from "@/lib/kanban/filters";

interface FunilDisponivel {
  id: string;
  name: string;
  settings: Record<string, unknown> | null;
}

export function PipelinePageClient({
  pipelineId,
  initialName,
  funisDisponiveis = [{ id: pipelineId, name: initialName, settings: null }],
}: {
  pipelineId: string;
  initialName: string;
  funisDisponiveis?: FunilDisponivel[];
}) {
  const t = useT();
  const { data, isLoading, error, pulses, realtimeStatus, seguranca } = useBoard(pipelineId);
  const tipoOperacional = tipoOperacionalDoFunil(data?.pipeline.settings);
  const rotuloOperacional = rotuloDoTipoOperacional(tipoOperacional);
  const { data: radar } = useAtRiskLeads();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const setFilters = useCallback(
    (next: LeadFilters) => {
      const qs = filtersToParams(next);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [newOpen, setNewOpen] = useState(false);

  function trocarFunil(proximoId: string) {
    if (proximoId === pipelineId) return;
    setSelectedIds([]);
    router.push(`/app/pipelines/${proximoId}`);
  }

  const idsEmRisco = useMemo(() => {
    const ids = new Set<string>();
    for (const item of radar?.items ?? []) {
      if (item.pipeline_id !== pipelineId) continue;
      if (item.risk === "critico" || item.risk === "em_risco") ids.add(item.id);
    }
    return ids;
  }, [radar, pipelineId]);

  const filteredLeads = data ? applyFilters(data.leads, filters) : [];
  // NÃO é a conta do FilterBar: o seletor de filtro lista as três caixas
  // (`marcadoresDoCard`: negócio, contato e conversa), e esta lista, a da tag em
  // lote, só `lead.tags` — é lá que a ação em lote grava (#852). O `useMemo` é o
  // mesmo cuidado de lá: solta no corpo, a conta roda em toda renderização
  // e devolve um array NOVO a cada vez. E esta página re-renderiza a cada tecla
  // da busca (o debounce do FilterBar mexe na query string) e a cada mudança de
  // seleção de card.
  const tagsDoQuadro = useMemo(
    () => [...new Set((data?.leads ?? []).flatMap((l) => l.tags))].sort(),
    [data?.leads],
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-5"
      // OBSERVÁVEL de propósito, e é a razão de existir desta linha: "a
      // assinatura morreu" e "nada aconteceu" produzem o MESMO silêncio na
      // tela, e sem este valor nem o produto nem o teste conseguem separar as
      // duas famílias de causa. Com ele, quem investiga olha DURANTE a rodada
      // que falha: `subscribed` manda procurar a montante (entrega, filtro, ou
      // o evento nunca saiu); `channel_error`/`timed_out`/`closed` já é a
      // resposta.
      //
      // Ainda NÃO religa — religar é desenho e merece bloco próprio. Isto aqui
      // é só parar de descartar o que já era calculado.
      data-realtime-status={realtimeStatus.toLowerCase()}
      // A rede de segurança fica OBSERVÁVEL pelo mesmo motivo do status do
      // canal: "a entrega morreu" e "nada aconteceu" têm a mesma aparência, que
      // é silêncio. Aqui o número de divergências é a diferença entre os dois —
      // e é o sinal que faltava para uma verificação poder APROVAR, e não só
      // reprovar.
      data-refetch-divergencias={seguranca.divergencias}
      data-refetch-em={seguranca.ultimaVerificacao ?? ""}
    >
      {/* `flex-col` no mobile: nome de funil comprido (é texto livre, sem
          limite curto) + botão na mesma linha sem quebra empurrava o botão pra
          fora da viewport em telas estreitas. De `sm:` pra cima volta a ser
          uma linha só, como sempre foi. */}
      <header className="relative overflow-hidden rounded-[24px] border border-border/60 bg-gradient-to-br from-card via-card to-muted/35 p-5 shadow-[0_10px_32px_rgba(0,0,0,0.045)] sm:p-6">
        <div
          className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full bg-primary/[0.045] blur-3xl"
          aria-hidden="true"
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="sr-only">{data?.pipeline.name ?? initialName}</h1>
            <p className="mb-2 text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              {t("Funil de operação")}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={pipelineId} onValueChange={trocarFunil}>
                <SelectTrigger
                  className="h-11 w-full min-w-[220px] rounded-xl border-border/60 bg-background/75 text-[15px] font-semibold shadow-sm sm:w-[320px]"
                  aria-label={t("Alterar funil")}
                  data-testid="seletor-funil"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {funisDisponiveis.map((funil) => {
                    const tipo = tipoOperacionalDoFunil(funil.settings);
                    const rotulo = rotuloDoTipoOperacional(tipo) ?? funil.name;
                    return (
                      <SelectItem key={funil.id} value={funil.id}>
                        {t(rotulo)}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {rotuloOperacional ? <Badge variant="outline">{t(rotuloOperacional)}</Badge> : null}
            </div>
            {data?.pipeline.description ? (
              <p className="mt-1.5 text-sm text-muted-foreground">{data.pipeline.description}</p>
            ) : null}
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:flex sm:flex-wrap">
            <Button variant="outline" asChild className="w-full rounded-xl bg-background/70 sm:w-auto sm:shrink-0">
              <Link href="/app/kanban/gerenciar">{t("Gerenciar funis")}</Link>
            </Button>
            <Button
              onClick={() => setNewOpen(true)}
              disabled={!data}
              className="w-full rounded-xl sm:w-auto sm:shrink-0"
            >
              <Plus size={16} className="mr-2" /> {t("Novo Lead")}
            </Button>
          </div>
        </div>
      </header>
      {data && (
        <NewLeadDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          pipelineId={pipelineId}
          stages={data.stages}
        />
      )}
      {data ? (
        <ResumoOperacionalDoFunil
          leads={data.leads}
          idsEmRisco={idsEmRisco}
          tipoOperacional={tipoOperacional}
          onSemResponsavel={() => setFilters({ ...filters, owner: "unassigned" })}
          onPrazoVencido={() => setFilters({ ...filters, overdueOnly: true })}
        />
      ) : null}
      <FilterBar filters={filters} onChange={setFilters} leads={data?.leads ?? []} />
      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm">
          {t("Não consegui carregar este funil:")} {formatError(error, t)}
        </div>
      ) : isLoading || !data ? (
        <div className="flex flex-1 animate-pulse items-center justify-center text-muted-foreground">
          {t("Carregando…")}
        </div>
      ) : (
        <KanbanBoard
          pipelineId={pipelineId}
          stages={data.stages}
          leads={filteredLeads}
          pulses={pulses}
          pipeline={data.pipeline}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          leadInicial={searchParams.get("lead")}
        />
      )}
      <BulkActionBar
        selectedIds={selectedIds}
        stages={data?.stages ?? []}
        pipelineId={pipelineId}
        vocabulary={data?.pipeline.vocabulary ?? null}
        tagsExistentes={tagsDoQuadro}
        onClear={() => setSelectedIds([])}
      />
    </div>
  );
}
