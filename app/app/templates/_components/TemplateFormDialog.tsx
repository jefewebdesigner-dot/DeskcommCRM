"use client";

import { useT } from "@/hooks/i18n/useT";
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { MessageTemplate } from "@/hooks/inbox/useMessageTemplates";

const TEMPLATES_KEY = ["message-templates"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canShare: boolean;
  template?: MessageTemplate | null;
}

interface CreateInput {
  title: string;
  body: string;
  shortcut?: string;
  shared?: boolean;
}

interface UpdateInput {
  id: string;
  title: string;
  body: string;
  shortcut: string | null;
}

export function TemplateFormDialog({ open, onOpenChange, canShare, template }: Props) {
  const t = useT();
  const isEdit = !!template;
  const [title, setTitle] = React.useState(template?.title ?? "");
  const [body, setBody] = React.useState(template?.body ?? "");
  const [shortcut, setShortcut] = React.useState(template?.shortcut ?? "");
  const [shared, setShared] = React.useState(template ? template.owner_user_id === null : false);
  const bodyRef = React.useRef<HTMLTextAreaElement | null>(null);

  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: async (input: CreateInput) =>
      apiClient.post<{ data: MessageTemplate }>("/api/v1/message-templates", input),
    onError: showApiError,
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
  const update = useMutation({
    mutationFn: async ({ id, ...input }: UpdateInput) =>
      apiClient.patch<{ data: MessageTemplate }>(`/api/v1/message-templates/${id}`, input),
    onError: showApiError,
    onSuccess: () => qc.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
  const pending = create.isPending || update.isPending;

  function inserirVariavel(variavel: "{{primeiro_nome}}" | "{{nome}}" | "{{empresa}}") {
    const campo = bodyRef.current;
    if (!campo) {
      setBody((atual) => `${atual}${variavel}`);
      return;
    }
    const inicio = campo.selectionStart ?? body.length;
    const fim = campo.selectionEnd ?? body.length;
    setBody(body.slice(0, inicio) + variavel + body.slice(fim));
    requestAnimationFrame(() => {
      campo.focus();
      const posicao = inicio + variavel.length;
      campo.selectionStart = campo.selectionEnd = posicao;
    });
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isEdit) {
        await update.mutateAsync({
          id: template.id,
          title,
          body,
          shortcut: shortcut.trim() || null,
        });
        toast.success(t("Resposta rápida atualizada."));
      } else {
        await create.mutateAsync({
          title,
          body,
          shortcut: shortcut.trim() || undefined,
          shared: canShare ? shared : false,
        });
        toast.success(t("Resposta rápida criada."));
      }
      onOpenChange(false);
    } catch {
      /* erro já mostrado pelo showApiError */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[22px] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("Editar resposta rápida") : t("Nova resposta rápida")}
          </DialogTitle>
          <DialogDescription>
            {t("Crie uma mensagem reutilizável para o atendimento comercial e operacional.")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="tpl-title">{t("Título")}</Label>
            <Input
              id="tpl-title"
              className="rounded-xl"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("Saudação inicial")}
              minLength={1}
              maxLength={80}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tpl-body">{t("Mensagem")}</Label>
            <Textarea
              ref={bodyRef}
              id="tpl-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("Oi {{primeiro_nome}}, tudo bem?")}
              minLength={1}
              maxLength={4096}
              required
              rows={7}
              className="rounded-xl bg-muted/[0.12]"
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("Inserir variável:")}</span>
              {(["{{primeiro_nome}}", "{{nome}}", "{{empresa}}"] as const).map((variavel) => (
                <Button
                  key={variavel}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-lg px-2 font-mono text-[11px]"
                  onClick={() => inserirVariavel(variavel)}
                >
                  {variavel}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                "O Inbox preenche nome do cliente e nome da empresa automaticamente antes do envio.",
              )}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tpl-shortcut">{t("Atalho (opcional)")}</Label>
            <Input
              id="tpl-shortcut"
              className="rounded-xl"
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value)}
              placeholder="oi"
              maxLength={40}
            />
          </div>
          {canShare && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/[0.14] p-3">
              <Switch
                id="tpl-shared"
                checked={shared}
                onCheckedChange={setShared}
                disabled={isEdit}
              />
              <Label htmlFor="tpl-shared">{t("Compartilhar com a equipe")}</Label>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="rounded-xl"
              onClick={() => onOpenChange(false)}
            >
              {t("Cancelar")}
            </Button>
            <Button type="submit" className="rounded-xl" disabled={pending}>
              {isEdit ? t("Salvar") : t("Criar resposta rápida")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
