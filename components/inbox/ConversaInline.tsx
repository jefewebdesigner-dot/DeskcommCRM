"use client";
import { useEffect, useState } from "react";

import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { isNotFound, useConversation } from "@/hooks/inbox/useConversation";
import { JanelaFechadaAviso } from "@/components/inbox/JanelaFechadaAviso";
import { estadoDaJanela, formatarDecorrido } from "@/lib/channels/janela";
import type { Message as ConversationMensagem } from "@/lib/types/messaging";
import { ChatThread } from "./ChatThread";
import { Composer } from "./Composer";
import { RetentionNotice } from "./RetentionNotice";

/**
 * A conversa do Inbox, DENTRO de outra tela (dossiê do funil, tarefa).
 *
 * Existe porque o atalho "Abrir conversa no Inbox" levava o operador para outra
 * página: ele lia, respondia, e tinha que voltar ao funil para continuar o
 * trabalho — perdendo o lugar a cada contato. Aqui o histórico e a caixa de
 * envio aparecem no lugar onde a pessoa já está.
 *
 * Reusa `ChatThread` e `Composer` do Inbox, não uma cópia: as regras de envio
 * (janela de 24h, contato bloqueado, somente leitura de suporte) são as mesmas
 * e precisam continuar sendo UMA só. Se uma regra nova entrar no Inbox, entra
 * aqui junto.
 */
export function ConversaInline({
  conversationId,
  className,
}: {
  conversationId: string;
  className?: string;
}) {
  const t = useT();
  const { activeOrg, user } = useAuth();
  const supportReadonly = user.support?.access_mode === "support_readonly";
  const q = useConversation(conversationId, true);
  const conversation = q.data ?? null;
  // A citação guarda a conversa a que pertence: ao trocar de contato ela deixa de
  // valer sozinha, sem efeito que zere o estado depois da renderização.
  const [citacao, setCitacao] = useState<{
    conversationId: string;
    mensagem: ConversationMensagem;
  } | null>(null);
  const respondendo = citacao?.conversationId === conversationId ? citacao.mensagem : null;

  // A janela vence sozinha com a tela aberta (mesmo relógio do Inbox).
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const caixa = `flex h-[34rem] max-h-[70vh] min-h-[22rem] flex-col overflow-hidden rounded-lg border border-border bg-background ${className ?? ""}`;

  if (q.isLoading) {
    return (
      <div className={caixa}>
        <div className="flex h-full items-center justify-center text-sm text-text-muted">
          {t("Carregando conversa…")}
        </div>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className={caixa}>
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-text-muted">
          {isNotFound(q.error)
            ? t("Esta conversa não existe mais ou está fora do seu acesso.")
            : t("Não foi possível carregar a conversa. Tente de novo em instantes.")}
        </div>
      </div>
    );
  }

  const janela = estadoDaJanela(
    conversation.channel_sessions?.provider ?? null,
    conversation.last_inbound_at ?? null,
    agora,
  );
  const motivoDaJanela =
    janela.tipo === "fechada"
      ? janela.fechadaHaMs === null
        ? t(
            "O cliente ainda não escreveu — a janela de 24h nunca abriu. Só um modelo aprovado sai daqui.",
          )
        : `${t("A janela de 24h fechou há")} ${formatarDecorrido(janela.fechadaHaMs)}. ${t("Só um modelo aprovado sai daqui — texto livre é recusado.")}`
      : null;

  const blockedReason = conversation.contacts?.is_blocked
    ? t("Contato bloqueado — envio de mensagens desabilitado.")
    : conversation.contacts?.is_anonymized
      ? t("Contato anonimizado — não é possível enviar mensagens.")
      : null;

  return (
    <div className={caixa} data-testid="conversa-inline">
      <div className="min-h-0 flex-1 overflow-hidden">
        <ChatThread
          conversationId={conversation.id}
          onResponder={(mensagem) => setCitacao({ conversationId, mensagem })}
          dono={{
            userId: conversation.assigned_to_user_id ?? null,
            nome: conversation.assigned_to_user_name ?? null,
          }}
          contatoId={conversation.contacts?.id ?? null}
        />
      </div>
      <RetentionNotice conversationId={conversation.id} />
      {motivoDaJanela && (
        <JanelaFechadaAviso
          conversationId={conversation.id}
          provider={conversation.channel_sessions?.provider ?? null}
          motivo={motivoDaJanela}
        />
      )}
      <Composer
        conversationId={conversation.id}
        blockedReason={supportReadonly ? t("Acompanhamento somente leitura") : blockedReason}
        janelaFechada={motivoDaJanela}
        disabled={["closed", "resolved", "archived"].includes(conversation.status)}
        contactName={conversation.contacts?.name ?? null}
        organizationName={activeOrg?.name ?? null}
        respondendo={respondendo}
        onCancelarResposta={() => setCitacao(null)}
        currentContactId={conversation.contact_id}
      />
    </div>
  );
}
