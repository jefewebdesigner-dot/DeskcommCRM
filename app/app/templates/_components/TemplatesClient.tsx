"use client";

import { useT } from "@/hooks/i18n/useT";
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { MagnifyingGlass, Plus, PencilSimple, Trash } from "@/lib/ui/icons";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useMessageTemplates, type MessageTemplate } from "@/hooks/inbox/useMessageTemplates";
import {
  RESPOSTAS_RAPIDAS_SUGERIDAS,
  respostaSugeridaPorAtalhoOuTitulo,
} from "@/lib/inbox/respostas-sugeridas";
import { TemplateFormDialog } from "./TemplateFormDialog";

const TEMPLATES_KEY = ["message-templates"];

interface Props {
  canShare: boolean;
  currentUserId: string;
}

export function TemplatesClient({ canShare, currentUserId }: Props) {
  const t = useT();
  const { data: templates, isLoading } = useMessageTemplates();
  const qc = useQueryClient();
  const [query, setQuery] = React.useState("");
  const [scope, setScope] = React.useState<"all" | "shared" | "personal">("all");
  const del = useMutation({
    mutationFn: async (id: string) => apiClient.delete(`/api/v1/message-templates/${id}`),
    onError: showApiError,
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<MessageTemplate | null>(null);

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (template: MessageTemplate) => {
    setEditing(template);
    setFormOpen(true);
  };

  const atuais = templates ?? [];
  const shortcutsExistentes = new Set(
    atuais.flatMap((template) => (template.shortcut ? [template.shortcut.toLowerCase()] : [])),
  );
  const titulosExistentes = new Set(atuais.map((template) => template.title.toLowerCase()));
  const sugeridasAusentes = RESPOSTAS_RAPIDAS_SUGERIDAS.filter(
    (sugestao) =>
      !shortcutsExistentes.has(sugestao.shortcut.toLowerCase()) &&
      !titulosExistentes.has(sugestao.title.toLowerCase()),
  );
  const pacote = useMutation({
    mutationFn: async () => {
      let criadas = 0;
      for (const sugestao of sugeridasAusentes) {
        await apiClient.post("/api/v1/message-templates", {
          title: sugestao.title,
          body: sugestao.body,
          shortcut: sugestao.shortcut,
          shared: canShare,
        });
        criadas += 1;
      }
      return criadas;
    },
    onError: showApiError,
    onSettled: () => qc.invalidateQueries({ queryKey: TEMPLATES_KEY }),
    onSuccess: (criadas) => {
      toast.success(
        criadas === 1
          ? t("1 resposta sugerida adicionada.")
          : `${criadas} ${t("respostas sugeridas adicionadas.")}`,
      );
    },
  });
  const q = query.trim().toLowerCase();
  const visiveis = atuais.filter((template) => {
    if (scope === "shared" && template.owner_user_id !== null) return false;
    if (scope === "personal" && template.owner_user_id === null) return false;
    if (!q) return true;
    return [template.title, template.body, template.shortcut ?? ""].some((valor) =>
      valor.toLowerCase().includes(q),
    );
  });
  const compartilhadas = atuais.filter((template) => template.owner_user_id === null).length;
  const pessoais = atuais.length - compartilhadas;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
        <Skeleton className="h-12 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-3 gap-2 sm:gap-3" aria-label={t("Resumo das respostas rápidas")}>
        {[
          { label: t("Total"), value: atuais.length, helper: t("respostas disponíveis") },
          { label: t("Equipe"), value: compartilhadas, helper: t("visíveis para o time") },
          { label: t("Pessoais"), value: pessoais, helper: t("somente suas") },
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

      <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="relative min-w-0 flex-1 lg:max-w-xl">
          <MagnifyingGlass
            size={15}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Buscar por nome, texto ou atalho…")}
            aria-label={t("Buscar respostas rápidas")}
            className="h-9 rounded-xl border-border/60 bg-muted/25 pl-9 shadow-none"
          />
        </div>
        <div className="-mx-1 flex max-w-full flex-nowrap items-center gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0 [&::-webkit-scrollbar]:hidden">
          <div className="inline-flex shrink-0 rounded-xl bg-muted/45 p-1">
            {(
              [
                ["all", "Todas"],
                ["shared", "Equipe"],
                ["personal", "Pessoais"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={scope === value ? "default" : "ghost"}
                className="h-7 rounded-lg px-2.5 text-[11px]"
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
              >
                {t(label)}
              </Button>
            ))}
          </div>
          <Button type="button" className="shrink-0 rounded-xl" onClick={openNew}>
            <Plus /> {t("Nova resposta rápida")}
          </Button>
        </div>
      </div>

      {sugeridasAusentes.length > 0 ? (
        <section className="rounded-2xl border border-border/60 bg-muted/[0.16] p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold tracking-tight">
                {t("Pacote operacional sugerido")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t(
                  "Inclui primeiro contato, proposta, follow-up, contratação, onboarding, vencimento de fatura, cobrança, pagamento, ausência em compromisso e pós-venda. As mensagens usam nome do cliente e nome da empresa automaticamente.",
                )}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {sugeridasAusentes.map((sugestao) => (
                  <Badge key={sugestao.shortcut} variant="neutral">
                    /{sugestao.shortcut}
                  </Badge>
                ))}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full rounded-xl bg-background sm:w-auto sm:shrink-0"
              disabled={pacote.isPending}
              onClick={() => pacote.mutate()}
            >
              {pacote.isPending
                ? t("Adicionando…")
                : `${t("Adicionar pacote")} (${sugeridasAusentes.length})`}
            </Button>
          </div>
        </section>
      ) : null}

      {atuais.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-muted/[0.06] p-10 text-center">
          <p className="text-sm font-medium">{t("Nenhuma resposta rápida ainda.")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("Crie uma resposta manualmente ou instale o pacote sugerido para começar.")}
          </p>
        </div>
      ) : visiveis.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-muted/[0.06] p-10 text-center">
          <p className="text-sm font-medium">{t("Nenhuma resposta encontrada")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("Ajuste a busca ou o filtro de visibilidade.")}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visiveis.map((template) => {
            // Só quem pode editar/apagar pela RLS vê as ações: o dono do
            // pessoal, ou manager+ no compartilhado (owner null). Sem isto, um
            // agent veria botões que o backend rejeita (404/nada apagado).
            const canModify =
              template.owner_user_id === currentUserId ||
              (template.owner_user_id === null && canShare);
            return (
              <li
                key={template.id}
                className="group flex items-start justify-between gap-4 rounded-2xl border border-border/60 bg-card p-4 shadow-sm transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md"
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold tracking-[-0.01em]">{template.title}</span>
                    {template.shortcut ? (
                      <Badge variant="neutral" className="font-mono text-[10px]">
                        /{template.shortcut}
                      </Badge>
                    ) : null}
                    <Badge variant={template.owner_user_id ? "neutral" : "default"}>
                      {t(template.owner_user_id ? "Pessoal" : "Compartilhada")}
                    </Badge>
                  </div>
                  <p className="line-clamp-2 text-sm whitespace-pre-wrap text-muted-foreground">
                    {template.body}
                  </p>
                  {(() => {
                    const referencia = respostaSugeridaPorAtalhoOuTitulo(template);
                    return referencia ? (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{t("Objetivo")}:</span>{" "}
                        {t(referencia.objetivo)}
                      </p>
                    ) : null;
                  })()}
                </div>
                {canModify && (
                  <div className="flex shrink-0 gap-1 opacity-80 transition-opacity group-hover:opacity-100">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("Editar resposta rápida")}
                      onClick={() => openEdit(template)}
                    >
                      <PencilSimple />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t("Excluir resposta rápida")}
                        >
                          <Trash />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("Excluir esta resposta rápida?")}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t("Essa ação não pode ser desfeita.")}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() =>
                              del.mutate(template.id, {
                                onSuccess: () => toast.success(t("Resposta rápida excluída.")),
                              })
                            }
                          >
                            {t("Excluir")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <TemplateFormDialog
        key={`${editing?.id ?? "novo"}:${formOpen ? "aberto" : "fechado"}`}
        open={formOpen}
        onOpenChange={setFormOpen}
        canShare={canShare}
        template={editing}
      />
    </div>
  );
}
