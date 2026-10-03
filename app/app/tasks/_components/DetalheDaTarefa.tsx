"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, MessageCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useQuickReplySuggestion } from "@/hooks/inbox/useQuickReplySuggestion";
import { interpolateTemplate } from "@/lib/inbox/template-vars";
import { RESPOSTAS_RAPIDAS_SUGERIDAS } from "@/lib/inbox/respostas-sugeridas";
import { nomeDoContato, rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import type { Tarefa } from "@/lib/tarefas/tipos";

type EmbedNome = { name?: string | null } | Array<{ name?: string | null }> | null;

interface ContextoDaTarefa {
  task: Tarefa;
  lead: {
    id: string;
    title: string;
    status: string;
    pipeline_id: string;
    stage_id: string;
    value_cents: number | null;
    currency: string | null;
    last_activity_at: string | null;
    updated_at: string | null;
    crm_pipelines: EmbedNome;
    crm_stages: EmbedNome;
  } | null;
  contact: {
    id: string;
    name: string | null;
    display_name: string | null;
    phone_number: string | null;
    email: string | null;
    tags: string[] | null;
    last_activity_at: string | null;
  } | null;
  conversation: {
    id: string;
    status: string;
    last_message_preview: string | null;
    last_message_at: string | null;
    channel_session_id: string | null;
    updated_at: string | null;
  } | null;
  organization: { display_name: string | null } | null;
}

interface ResumoDoContato {
  demands?: unknown[];
  demandas?: Array<{
    id: string;
    estado: string;
    proximo_passo: string | null;
    prazo_em: string | null;
  }>;
  activities?: Array<{
    id: string;
    type: string;
    reason?: string | null;
    performed_at: string;
    performed_by_name?: string | null;
  }>;
}

function nomeDoEmbed(value: EmbedNome): string | null {
  const item = Array.isArray(value) ? value[0] : value;
  return item?.name ?? null;
}

function leData<T>(json: unknown): T {
  return (json as { data: T }).data;
}

function rotuloDoStatus(status: string): string {
  if (status === "pending") return "Pendente";
  if (status === "in_progress") return "Em andamento";
  if (status === "done") return "Concluída";
  if (status === "cancelled") return "Cancelada";
  if (status === "open") return "Aberto";
  if (status === "won") return "Ganho";
  if (status === "lost") return "Perdido";
  return status;
}

export function DetalheDaTarefa({
  tarefa,
  responsavel,
  aberto,
  aoMudarAbertura,
  aoConcluir,
}: {
  tarefa: Tarefa | null;
  responsavel: string | null;
  aberto: boolean;
  aoMudarAbertura: (aberto: boolean) => void;
  aoConcluir: (tarefa: Tarefa) => Promise<unknown>;
}) {
  const [mensagem, setMensagem] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [concluirDepois, setConcluirDepois] = useState(true);
  const [conversationIdCriado, setConversationIdCriado] = useState<string | null>(null);

  const contexto = useQuery({
    enabled: aberto && Boolean(tarefa?.id),
    queryKey: ["task-context", tarefa?.id],
    queryFn: async () => {
      const res = await fetch(`/api/v1/tasks/${tarefa!.id}/context`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          (json as { error?: { message?: string } })?.error?.message ??
            "Não foi possível carregar o contexto da tarefa.",
        );
      }
      return leData<ContextoDaTarefa>(json);
    },
    staleTime: 15_000,
  });

  const contactId = contexto.data?.contact?.id ?? tarefa?.contact_id ?? null;
  const resumo = useQuery({
    enabled: aberto && Boolean(contactId),
    queryKey: ["task-contact-summary", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/v1/contacts/${contactId}/crm-summary`);
      const json = await res.json();
      if (!res.ok) throw new Error("Não foi possível carregar o histórico do contato.");
      return leData<ResumoDoContato>(json);
    },
    staleTime: 15_000,
  });

  const sugestao = useQuickReplySuggestion(contactId);
  const conversationId = conversationIdCriado ?? contexto.data?.conversation?.id ?? null;

  function sugerirMensagem() {
    const atalho = sugestao.data?.shortcut ?? "followup";
    const modelo =
      RESPOSTAS_RAPIDAS_SUGERIDAS.find((item) => item.shortcut === atalho) ??
      RESPOSTAS_RAPIDAS_SUGERIDAS.find((item) => item.shortcut === "followup");
    if (!modelo) return;
    const contato = contexto.data?.contact;
    setMensagem(
      interpolateTemplate(modelo.body, {
        name: nomeDoContato(contato) ?? "",
        organizationName: contexto.data?.organization?.display_name ?? "",
      }),
    );
  }

  async function resolverConversa(): Promise<string> {
    if (conversationId) return conversationId;
    if (!contactId) throw new Error("Esta tarefa não está ligada a um contato.");

    const res = await fetch("/api/v1/conversations/open-with-contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_id: contactId }),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(
        (json as { error?: { message?: string } })?.error?.message ??
          "Não foi possível abrir a conversa.",
      );
    }
    const data = leData<{ conversation_id: string }>(json);
    setConversationIdCriado(data.conversation_id);
    return data.conversation_id;
  }

  async function enviarWhatsApp() {
    if (!mensagem.trim() || !tarefa) return;
    setEnviando(true);
    try {
      const conversa = await resolverConversa();
      const res = await fetch("/api/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversa,
          type: "text",
          body: mensagem.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          (json as { error?: { message?: string } })?.error?.message ??
            "Não foi possível enviar a mensagem.",
        );
      }

      if (concluirDepois && tarefa.status !== "done") {
        await aoConcluir(tarefa);
      }
      setMensagem("");
      toast.success(
        concluirDepois ? "Mensagem enviada e tarefa concluída." : "Mensagem enviada pelo CRM.",
      );
      void contexto.refetch();
      void resumo.refetch();
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Falha ao enviar a mensagem.");
    } finally {
      setEnviando(false);
    }
  }

  const lead = contexto.data?.lead;
  const contato = contexto.data?.contact;
  const atividades = resumo.data?.activities ?? [];
  const demandas = resumo.data?.demandas ?? [];

  return (
    <Sheet open={aberto} onOpenChange={aoMudarAbertura}>
      <SheetContent side="right" className="w-full overflow-y-auto bg-muted/[0.05] sm:max-w-xl">
        <SheetHeader className="border-b border-border/60 pr-8 pb-5">
          <div className="flex flex-wrap items-center gap-2">
            {responsavel ? <Badge variant="info">{responsavel}</Badge> : null}
            {tarefa ? <Badge variant="neutral">{rotuloDoStatus(tarefa.status)}</Badge> : null}
          </div>
          <SheetTitle className="text-xl tracking-[-0.025em]">
            {tarefa?.title ?? "Tarefa"}
          </SheetTitle>
          <SheetDescription>
            Contexto do lead, histórico e ação de WhatsApp em um só lugar.
          </SheetDescription>
        </SheetHeader>

        {contexto.isLoading ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : contexto.isError ? (
          <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {contexto.error instanceof Error
              ? contexto.error.message
              : "Não foi possível carregar o contexto."}
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Contato
                  </p>
                  <h3 className="mt-1 font-semibold">{rotuloDoContato(contato)}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[contato?.phone_number, contato?.email].filter(Boolean).join(" · ") ||
                      "Sem telefone/e-mail"}
                  </p>
                </div>
                {conversationId ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/app/inbox?id=${conversationId}`}>
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                      Inbox
                    </Link>
                  </Button>
                ) : null}
              </div>

              {contexto.data?.conversation?.last_message_preview ? (
                <div className="rounded-xl border border-border/50 bg-muted/35 p-3 text-xs">
                  <span className="font-medium">Última conversa: </span>
                  {contexto.data.conversation.last_message_preview}
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Negócio
                  </p>
                  <h3 className="mt-1 font-semibold">{lead?.title ?? "Sem negócio vinculado"}</h3>
                  {lead ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {nomeDoEmbed(lead.crm_pipelines) ?? "Funil"} ·{" "}
                      {nomeDoEmbed(lead.crm_stages) ?? "Etapa"} · {rotuloDoStatus(lead.status)}
                    </p>
                  ) : null}
                </div>
                {lead ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/app/pipelines/${lead.pipeline_id}?lead=${lead.id}`}>
                      Abrir card
                    </Link>
                  </Button>
                ) : null}
              </div>
              {tarefa?.description ? (
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  {tarefa.description}
                </p>
              ) : null}
            </section>

            <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Situação
                  </p>
                  <p className="mt-1 text-sm">
                    {demandas.length} demanda(s) aberta(s) · {atividades.length} atividade(s)
                    recentes
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                {demandas.slice(0, 3).map((demanda) => (
                  <div
                    key={demanda.id}
                    className="rounded-xl border border-border/60 bg-muted/[0.12] px-3 py-2 text-xs"
                  >
                    <span className="font-medium">{demanda.estado}</span>
                    <span className="text-muted-foreground">
                      {" · "}
                      {demanda.proximo_passo ?? "Sem próximo passo definido"}
                    </span>
                  </div>
                ))}
                {atividades.slice(0, 4).map((atividade) => (
                  <div
                    key={atividade.id}
                    className="flex items-start justify-between gap-3 text-xs"
                  >
                    <span className="min-w-0 truncate">{atividade.reason ?? atividade.type}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {new Date(atividade.performed_at).toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                ))}
                {demandas.length === 0 && atividades.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sem histórico adicional recente.</p>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    WhatsApp
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Escreva e envie sem sair do CRM.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={sugerirMensagem}
                  disabled={!contactId || sugestao.isLoading}
                >
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  Sugerir mensagem
                </Button>
              </div>

              {sugestao.data?.motivo ? (
                <p className="mb-2 text-[11px] text-muted-foreground">
                  Sugestão: {sugestao.data.motivo}
                </p>
              ) : null}

              <Textarea
                rows={5}
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
                placeholder="Escreva a mensagem que será enviada pelo WhatsApp..."
              />

              <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={concluirDepois}
                  onChange={(e) => setConcluirDepois(e.target.checked)}
                />
                Concluir esta tarefa depois do envio
              </label>

              <Button
                className="mt-3 w-full rounded-xl"
                disabled={enviando || !mensagem.trim() || !contactId}
                onClick={enviarWhatsApp}
              >
                {enviando ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <MessageCircle className="mr-2 h-4 w-4" />
                )}
                Enviar pelo WhatsApp
              </Button>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
