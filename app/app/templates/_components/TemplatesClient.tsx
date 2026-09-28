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
import { Plus, PencilSimple, Trash } from "@/lib/ui/icons";
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
    if (!q) return true;
    return [template.title, template.body, template.shortcut ?? ""].some((valor) =>
      valor.toLowerCase().includes(q),
    );
  });
  const compartilhadas = atuais.filter((template) => template.owner_user_id === null).length;
  const pessoais = atuais.length - compartilhadas;

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge variant="neutral">{atuais.length} {t("respostas")}</Badge>
          <Badge variant="default">{compartilhadas} {t("da equipe")}</Badge>
          <Badge variant="neutral">{pessoais} {t("pessoais")}</Badge>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {sugeridasAusentes.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              disabled={pacote.isPending}
              onClick={() => pacote.mutate()}
            >
              {pacote.isPending
                ? t("Adicionando…")
                : `${t("Adicionar pacote sugerido")} (${sugeridasAusentes.length})`}
            </Button>
          ) : null}
          <Button type="button" onClick={openNew}>
            <Plus /> {t("Nova resposta rápida")}
          </Button>
        </div>
      </div>

      {sugeridasAusentes.length > 0 ? (
        <section className="rounded-xl border border-border bg-muted/30 p-4">
          <p className="text-sm font-medium">{t("Pacote operacional sugerido")}</p>
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
        </section>
      ) : null}

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("Buscar por nome, texto ou atalho…")}
        aria-label={t("Buscar respostas rápidas")}
        className="max-w-xl"
      />

      {atuais.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="text-sm font-medium">{t("Nenhuma resposta rápida ainda.")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("Crie uma resposta manualmente ou instale o pacote sugerido para começar.")}
          </p>
        </div>
      ) : visiveis.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("Nenhuma resposta encontrada para esta busca.")}</p>
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
                className="flex items-start justify-between gap-4 rounded-xl border bg-card p-4"
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{template.title}</span>
                    {template.shortcut ? (
                      <Badge variant="neutral">/{template.shortcut}</Badge>
                    ) : null}
                    <Badge variant={template.owner_user_id ? "neutral" : "default"}>
                      {t(template.owner_user_id ? "Pessoal" : "Compartilhada")}
                    </Badge>
                  </div>
                  <p className="line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">
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
                  <div className="flex shrink-0 gap-1">
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
