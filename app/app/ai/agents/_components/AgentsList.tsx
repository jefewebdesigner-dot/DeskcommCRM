"use client";
import { useMemo, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Robot, Plus } from "@/lib/ui/icons";
import { useT } from "@/hooks/i18n/useT";
import { useAgentsList } from "@/hooks/ai/useAgents";
import type { AgentRow } from "@/hooks/ai/useAgent";
import { AgentCard } from "./AgentCard";
import { AgentsListFilters, type StatusFilter } from "./AgentsListFilters";
import { deriveAgentStatus } from "./AgentStatusBadge";

interface Props {
  initialData: AgentRow[];
  canWrite: boolean;
}

export function AgentsList({ initialData, canWrite }: Props) {
  const t = useT();
  const { data, isLoading } = useAgentsList({ initialData });
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const agents = useMemo(() => data ?? [], [data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agents.filter((a) => {
      const s = deriveAgentStatus(a);
      if (!showArchived && s === "archived") return false;
      if (status !== "all" && s !== status) return false;
      if (q && !a.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [agents, status, query, showArchived]);

  const resumo = useMemo(() => {
    let published = 0;
    let draft = 0;
    let archived = 0;
    for (const agent of agents) {
      const s = deriveAgentStatus(agent);
      if (s === "published") published += 1;
      else if (s === "archived") archived += 1;
      else draft += 1;
    }
    return { published, draft, archived };
  }, [agents]);

  if (!isLoading && agents.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-3 rounded-[24px] border-border/60 bg-muted/[0.06] p-10 text-center shadow-sm">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent"
          aria-hidden="true"
        >
          <Robot size={24} weight="duotone" />
        </span>
        <h2 className="font-semibold tracking-tight">{t("Nenhum agente configurado")}</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          {t(
            "Crie um agente para responder no WhatsApp com IA. Você define instruções, ferramentas, gatilhos e contexto.",
          )}
        </p>
        {canWrite && (
          <Link href="/app/ai/agents/new">
            <Button className="mt-1 rounded-xl">
              <Plus size={14} aria-hidden className="mr-2" /> {t("Novo agente")}
            </Button>
          </Link>
        )}
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-3 gap-2 sm:gap-3" aria-label={t("Resumo dos agentes")}>
        {[
          { label: t("No ar"), value: resumo.published, helper: t("atendendo agora") },
          { label: t("Em preparação"), value: resumo.draft, helper: t("ainda não publicados") },
          { label: t("Arquivados"), value: resumo.archived, helper: t("fora da operação") },
        ].map((item) => (
          <div
            key={item.label}
            className="min-w-0 rounded-2xl border border-border/60 bg-card p-3 shadow-sm sm:p-4"
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

      <div className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-card p-2.5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <AgentsListFilters
          status={status}
          onStatusChange={setStatus}
          query={query}
          onQueryChange={setQuery}
          showArchived={showArchived}
          onShowArchivedChange={setShowArchived}
        />
        {canWrite && (
          <Link href="/app/ai/agents/new">
            <Button className="w-full rounded-xl sm:w-auto">
              <Plus size={14} aria-hidden className="mr-2" /> {t("Novo agente")}
            </Button>
          </Link>
        )}
      </div>

      {filtered.length === 0 ? (
        <Card className="rounded-2xl border-dashed border-border/60 bg-muted/[0.06] p-10 text-center text-sm text-muted-foreground">
          {t("Nenhum agent corresponde aos filtros atuais.")}
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((agent) => (
            <li key={agent.id}>
              <AgentCard agent={agent} canWrite={canWrite} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
