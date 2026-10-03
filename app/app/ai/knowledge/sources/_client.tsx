"use client";

import { useT } from "@/hooks/i18n/useT";
import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";
import {
  chaveQueryKey,
  sourcesQueryKey,
  useArquivarSource,
  useEstadoDaChave,
  useKnowledgeSources,
  useReindexSource,
  type SourceRow,
} from "@/hooks/ai/useKnowledgeSources";
import { KnowledgeSourceCard } from "@/components/ai/KnowledgeSourceCard";
import { NovoMaterialDialog } from "@/components/ai/NovoMaterialDialog";
import { ChaveDeConhecimento, type EstadoDaChave } from "@/components/ai/ChaveDeConhecimento";

export interface AgenteQueUsa {
  id: string;
  nome: string;
  materiais: string[];
}

interface Props {
  initialSources: SourceRow[];
  initialChave: EstadoDaChave;
  agentes: AgenteQueUsa[];
}

export function AcervoClient({ initialSources, initialChave, agentes }: Props) {
  const t = useT();
  const qc = useQueryClient();
  const [novoAberto, setNovoAberto] = useState(false);

  const { data: sources } = useKnowledgeSources({ initialData: initialSources });
  const { data: chave } = useEstadoDaChave(initialChave);
  const reindex = useReindexSource();
  const arquivar = useArquivarSource();

  const recarregar = useCallback(() => {
    qc.invalidateQueries({ queryKey: sourcesQueryKey() });
    qc.invalidateQueries({ queryKey: chaveQueryKey() });
  }, [qc]);

  // Pelo hook compartilhado: `.channel()` cru assina como ANÔNIMO (o cookie de
  // sessão é httpOnly) — recebe "ok" e nunca entrega. Aqui o efeito era a lista
  // não atualizar sozinha quando o worker terminava de preparar o material, que
  // é justamente o momento em que a pessoa está olhando para a tela.
  useRealtimeChannel({
    name: "acervo-de-conhecimento",
    postgresChanges: { event: "*", schema: "public", table: "ai_knowledge_sources" },
    onChange: recarregar,
  });

  const lista = (sources ?? []).filter((s) => s.status !== "archived");
  const arquivados = (sources ?? []).filter((s) => s.status === "archived");
  const estado = chave ?? initialChave;

  function usadoPor(sourceId: string): string[] {
    return agentes.filter((a) => a.materiais.includes(sourceId)).map((a) => a.nome);
  }

  return (
    <div className="space-y-5">
      <ChaveDeConhecimento estado={estado} onChaveCadastrada={recarregar} />

      <section className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {t("Acervo ativo")}
          </p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {lista.length === 0
              ? t("Nenhum material ainda.")
              : `${lista.length} ${lista.length === 1 ? t("material") : t("materiais")} ${t("no acervo.")}`}
          </p>
        </div>
        <Button
          className="rounded-xl"
          onClick={() => setNovoAberto(true)}
          data-testid="acervo-adicionar"
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          {t("Adicionar material")}
        </Button>
      </section>

      <NovoMaterialDialog
        aberto={novoAberto}
        onFechar={() => setNovoAberto(false)}
        onCriado={recarregar}
        podeIndexar={estado.pode_indexar}
      />

      {lista.length === 0 ? (
        <div
          className="rounded-[24px] border border-dashed border-border/60 bg-muted/[0.06] px-6 py-14 text-center shadow-sm"
          data-testid="acervo-vazio"
        >
          <p className="text-sm font-medium">{t("O agente ainda não conhece o seu negócio")}</p>
          <p className="mx-auto mt-1 max-w-prose text-sm text-text-muted">
            {t(
              "Comece pelo que ele mais vai precisar: as perguntas que se repetem, e a política que você mais explica. Ele passa a consultar isso antes de responder, em vez de improvisar.",
            )}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {lista.map((s) => (
            <KnowledgeSourceCard
              key={s.id}
              source={s}
              usadoPor={usadoPor(s.id)}
              isReindexing={reindex.isPending && reindex.variables === s.id}
              onReindex={() => reindex.mutate(s.id)}
              onArquivar={() => arquivar.mutate(s.id)}
              onMudou={recarregar}
            />
          ))}
        </div>
      )}

      {arquivados.length > 0 ? (
        <details
          className="group rounded-2xl border border-border/60 bg-muted/[0.06] p-4"
          data-testid="acervo-arquivados"
        >
          <summary className="cursor-pointer text-sm font-semibold tracking-tight">
            {arquivados.length} {arquivados.length === 1 ? t("arquivado") : t("arquivados")}
          </summary>
          <p className="mt-2 text-xs text-text-muted">
            {t(
              "Material arquivado não é consultado por nenhum assistente, e não é apagado — o histórico do que o agente já soube continua existindo.",
            )}
          </p>
          <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            {arquivados.map((s) => (
              <li
                key={s.id}
                className="rounded-xl border border-border/50 bg-background/70 px-3 py-2 text-text-muted"
              >
                {s.name}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
