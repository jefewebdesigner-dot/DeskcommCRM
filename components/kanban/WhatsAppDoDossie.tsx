"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useActiveOrg } from "@/hooks/auth/AuthProvider";
import { useQuickReplySuggestion } from "@/hooks/inbox/useQuickReplySuggestion";
import { interpolateTemplate } from "@/lib/inbox/template-vars";
import { RESPOSTAS_RAPIDAS_SUGERIDAS } from "@/lib/inbox/respostas-sugeridas";
import type { Lead } from "@/lib/types/leads";

interface Modelo {
  id: string;
  title: string;
  body: string;
  shortcut: string | null;
}

function corpoDaResposta<T>(json: unknown): T {
  return (json as { data: T }).data;
}

export function WhatsAppDoDossie({
  lead,
  pipelineId,
}: {
  lead: Lead;
  pipelineId: string;
}) {
  const org = useActiveOrg();
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  const [modeloId, setModeloId] = useState<string | undefined>();
  const [enviando, setEnviando] = useState(false);
  const [sugerindo, setSugerindo] = useState(false);
  const [conversationIdCriado, setConversationIdCriado] = useState<string | null>(null);
  const sugestao = useQuickReplySuggestion(lead.contact_id);

  const modelos = useQuery({
    queryKey: ["message-templates", "lead-dossier"],
    queryFn: async () => {
      const res = await fetch("/api/v1/message-templates");
      if (!res.ok) return [] as Modelo[];
      const json = await res.json();
      return corpoDaResposta<Modelo[]>(json);
    },
    staleTime: 60_000,
  });

  const nomeContato =
    lead.contact?.display_name ?? lead.contact?.name ?? lead.title ?? "";
  const contextoTemplate = {
    name: nomeContato,
    organizationName: org?.name ?? "",
  };

  function aplicarModelo(modelo: Modelo) {
    setModeloId(modelo.id);
    setTexto(interpolateTemplate(modelo.body, contextoTemplate));
  }

  function aplicarSugestaoRapida() {
    const atalho = sugestao.data?.shortcut ?? "followup";
    const cadastrado = (modelos.data ?? []).find((m) => m.shortcut === atalho);
    if (cadastrado) {
      aplicarModelo(cadastrado);
      return;
    }
    const padrao =
      RESPOSTAS_RAPIDAS_SUGERIDAS.find((m) => m.shortcut === atalho) ??
      RESPOSTAS_RAPIDAS_SUGERIDAS.find((m) => m.shortcut === "followup");
    if (!padrao) return;
    setModeloId(undefined);
    setTexto(interpolateTemplate(padrao.body, contextoTemplate));
  }

  async function sugerir() {
    const conversationId = conversationIdCriado ?? lead.conversa?.id ?? null;
    if (!conversationId) {
      aplicarSugestaoRapida();
      return;
    }

    setSugerindo(true);
    try {
      // A sugestão de IA lê o histórico REAL desta conversa e nunca envia por
      // conta própria: só preenche o composer para revisão/edição humana.
      const res = await fetch(
        `/api/v1/conversations/${conversationId}/draft-reply`,
        { method: "POST" },
      );
      const json = await res.json().catch(() => null);
      if (res.ok) {
        const data = corpoDaResposta<{ draft: string }>(json);
        if (data.draft?.trim()) {
          setModeloId(undefined);
          setTexto(data.draft.trim());
          return;
        }
      }
    } catch {
      // Sem agente publicado, canal ou provedor disponível, a heurística local
      // continua útil e evita transformar "Sugerir" em botão quebrado.
    } finally {
      setSugerindo(false);
    }

    aplicarSugestaoRapida();
  }

  async function resolverConversa(): Promise<string> {
    const existente = conversationIdCriado ?? lead.conversa?.id ?? null;
    if (existente) return existente;
    if (!lead.contact_id) throw new Error("Este negócio não está ligado a um contato.");

    const res = await fetch("/api/v1/conversations/open-with-contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_id: lead.contact_id }),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(
        (json as { error?: { message?: string } }).error?.message ??
          "Não foi possível abrir a conversa.",
      );
    }
    const data = corpoDaResposta<{ conversation_id: string }>(json);
    setConversationIdCriado(data.conversation_id);
    return data.conversation_id;
  }

  async function enviar() {
    if (!texto.trim()) return;
    setEnviando(true);
    try {
      const conversationId = await resolverConversa();
      const res = await fetch("/api/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          type: "text",
          body: texto.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          (json as { error?: { message?: string } }).error?.message ??
            "Não foi possível enviar a mensagem.",
        );
      }
      setTexto("");
      setModeloId(undefined);
      toast.success("Mensagem enviada pelo WhatsApp do CRM.");
      await qc.invalidateQueries({ queryKey: ["board", pipelineId] });
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Falha ao enviar a mensagem.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="mt-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-foreground">WhatsApp</p>
          <p className="mt-0.5 text-[11px] text-text-muted">
            Use uma mensagem pronta, ajuste se quiser e envie sem sair do negócio.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void sugerir()}
          disabled={!lead.contact_id || sugestao.isLoading || sugerindo}
          className="shrink-0"
        >
          {sugerindo ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          )}
          Sugerir
        </Button>
      </div>

      {(modelos.data ?? []).length > 0 ? (
        <Select
          value={modeloId}
          onValueChange={(id) => {
            const modelo = modelos.data?.find((m) => m.id === id);
            if (modelo) aplicarModelo(modelo);
          }}
        >
          <SelectTrigger className="mb-2">
            <SelectValue placeholder="Escolher mensagem pronta" />
          </SelectTrigger>
          <SelectContent>
            {(modelos.data ?? []).map((modelo) => (
              <SelectItem key={modelo.id} value={modelo.id}>
                {modelo.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {sugestao.data?.motivo ? (
        <p className="mb-2 text-[11px] text-text-muted">
          Sugestão do CRM: {sugestao.data.motivo}
        </p>
      ) : null}

      <Textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={4}
        placeholder="Mensagem para o cliente..."
      />
      <Button
        type="button"
        className="mt-2 w-full"
        onClick={enviar}
        disabled={!lead.contact_id || !texto.trim() || enviando}
      >
        {enviando ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <MessageCircle className="mr-2 h-4 w-4" />
        )}
        Enviar pelo CRM
      </Button>
    </section>
  );
}
