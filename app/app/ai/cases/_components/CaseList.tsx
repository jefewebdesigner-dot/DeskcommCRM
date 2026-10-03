"use client";

import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCases, type CaseListItem } from "@/hooks/ai/useCases";
import { STATUS_BADGE_VARIANT, STATUS_LABEL, tipoDeCasoLabel } from "@/lib/ai/case-copy";
import { Robot } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/i18n/useT";
import { CaseDetail } from "./CaseDetail";

export function CaseList() {
  const t = useT();
  const [tab, setTab] = useState<"open" | "resolved">("open");
  // Deep link: o aviso "um atendimento espera decisão" na Central manda para cá
  // com o id do caso. Sem isto ele abriria a LISTA, e quem clicou teria que
  // caçar de qual caso o aviso falava — um aviso que não leva ao seu assunto é
  // meio aviso. Só o valor INICIAL: clicar na lista continua mandando, e a URL
  // não vira estado a sincronizar.
  // `?.` porque o hook devolve null fora de um contexto de navegação (o que
  // acontece em teste e em render estático). Sem a guarda, a tela inteira
  // quebra com "Cannot read properties of null".
  const idDaUrl = useSearchParams()?.get("caso") ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(idDaUrl);
  const { data, isLoading } = useCases(tab);

  return (
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="flex min-h-0 w-full flex-col gap-3 rounded-[24px] border border-border/60 bg-muted/[0.08] p-3 shadow-sm">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "open" | "resolved")}>
          <TabsList className="h-10 w-full rounded-xl border border-border/50 bg-background/70 p-1">
            <TabsTrigger value="open" className="flex-1 rounded-lg text-xs">
              {t("Abertos")}
              {data ? ` (${data.open_count})` : ""}
            </TabsTrigger>
            <TabsTrigger value="resolved" className="flex-1 rounded-lg text-xs">
              {t("Concluídos")}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !data || data.cases.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/60 bg-background/60 px-4 py-16 text-center">
            <span
              className="flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground"
              aria-hidden="true"
            >
              <Robot size={22} weight="duotone" />
            </span>
            <p className="text-sm font-medium">
              {tab === "open" ? t("Nenhum caso aberto") : t("Nenhum caso concluído")}
            </p>
            <p className="text-xs text-muted-foreground">
              {tab === "open"
                ? t("Quando a IA precisar de você, aparece aqui.")
                : t("Casos concluídos, cancelados ou repassados ficam aqui.")}
            </p>
          </div>
        ) : (
          <ul className="min-h-0 space-y-2 overflow-y-auto">
            {data.cases.map((c) => (
              <CaseRow
                key={c.id}
                item={c}
                selected={c.id === selectedId}
                onSelect={() => setSelectedId(c.id)}
              />
            ))}
          </ul>
        )}
      </aside>

      <section className="min-w-0 rounded-[24px] border border-border/60 bg-card p-4 shadow-sm sm:p-5">
        <CaseDetail caseId={selectedId} />
      </section>
    </div>
  );
}

function CaseRow({
  item,
  selected,
  onSelect,
}: {
  item: CaseListItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const localeDaData = useLocaleDeData();
  const t = useT();
  const when = formatDistanceToNowStrict(new Date(item.opened_at), {
    addSuffix: true,
    locale: localeDaData,
  });
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        data-testid="case-item"
        className={cn(
          "flex w-full flex-col items-start gap-1.5 rounded-2xl border border-transparent bg-background/70 px-3.5 py-3 text-left shadow-sm transition-[background,border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-border/60 hover:bg-background hover:shadow-md",
          selected && "border-accent/20 bg-accent-soft ring-1 ring-accent/10",
        )}
      >
        <div className="flex w-full items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold tracking-[-0.01em]">{item.title}</p>
          <Badge variant={STATUS_BADGE_VARIANT[item.status]} className="shrink-0">
            {t(STATUS_LABEL[item.status])}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {/* O assunto vem ANTES do nome: quem tria a fila decide por ele, e o
              nome só importa depois de escolher o caso. */}
          {t(tipoDeCasoLabel(item.kind))} · {item.contact_name ?? t("Contato sem nome")} · {when}
        </p>
      </button>
    </li>
  );
}
