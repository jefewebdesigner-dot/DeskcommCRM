"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CheckCircle2, ListTodo, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTasks } from "@/hooks/tasks/useTasks";
import type { Lead } from "@/lib/types/leads";

function amanhaAsNove(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

function prazoCurto(iso: string | null): string {
  if (!iso) return "Sem prazo";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function TarefasDoDossie({ lead }: { lead: Lead }) {
  const { tarefas, carregando, criarTarefa, alternarConcluida } = useTasks({
    lead_id: lead.id,
    aberto: true,
  });
  const [criando, setCriando] = useState(false);
  const nome = lead.contact?.display_name ?? lead.contact?.name ?? lead.title;
  const [titulo, setTitulo] = useState(() => `Próximo passo · ${nome}`);

  const proximas = useMemo(
    () =>
      [...tarefas]
        .sort((a, b) => {
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return Date.parse(a.due_date) - Date.parse(b.due_date);
        })
        .slice(0, 3),
    [tarefas],
  );

  async function criar() {
    const texto = titulo.trim();
    if (!texto) return;
    await criarTarefa({
      title: texto,
      description: "Criada pelo dossiê do Funil. Registrar o resultado e definir o próximo passo.",
      due_date: amanhaAsNove(),
      priority: "medium",
      lead_id: lead.id,
      contact_id: lead.contact_id,
      responsible_profile_id: lead.responsible_profile_id ?? null,
    });
    setTitulo(`Próximo passo · ${nome}`);
    setCriando(false);
  }

  return (
    <div className="rounded-lg border border-border bg-muted/20">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <span className="flex items-center gap-2 text-sm font-medium">
          <ListTodo className="h-4 w-4 text-primary" />
          Próximas tarefas
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => setCriando((v) => !v)}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Nova
        </Button>
      </div>

      <div className="border-t border-border px-3 py-3">
        {criando ? (
          <div className="mb-3 flex gap-2">
            <Input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Próxima ação"
              onKeyDown={(e) => {
                if (e.key === "Enter") void criar();
              }}
            />
            <Button type="button" size="sm" onClick={() => void criar()}>
              Criar
            </Button>
          </div>
        ) : null}

        {carregando ? (
          <p className="text-xs text-text-muted">Carregando tarefas…</p>
        ) : proximas.length ? (
          <div className="space-y-2">
            {proximas.map((tarefa) => (
              <div
                key={tarefa.id}
                className="flex items-center gap-2 rounded-md border border-border/70 bg-background px-2.5 py-2"
              >
                <button
                  type="button"
                  onClick={() => void alternarConcluida(tarefa)}
                  className="shrink-0 text-text-muted hover:text-success"
                  aria-label="Concluir tarefa"
                >
                  <CheckCircle2 className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-text">{tarefa.title}</p>
                  <p className="text-[11px] text-text-muted">{prazoCurto(tarefa.due_date)}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-muted">
            Nenhuma tarefa aberta. Crie a próxima ação sem sair do negócio.
          </p>
        )}

        <Button asChild type="button" variant="ghost" size="sm" className="mt-2 w-full">
          <Link href="/app/tasks">Abrir central de tarefas</Link>
        </Button>
      </div>
    </div>
  );
}
