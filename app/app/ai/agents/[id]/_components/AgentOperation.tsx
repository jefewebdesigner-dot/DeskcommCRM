"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { AgentRow } from "@/hooks/ai/useAgent";
export function AgentOperation({ agent, readOnly }: { agent: AgentRow; readOnly?: boolean }) {
  const t = useT(),
    router = useRouter(),
    [busy, setBusy] = useState(false);
  async function change(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await apiClient.patch(`/api/v1/ai/agents/${agent.id}`, body);
      router.refresh();
    } catch (e) {
      showApiError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/60 bg-card p-4 shadow-sm"
      aria-label={t("Operação do agente")}
    >
      <label className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm font-semibold tracking-tight">
        {t("Operação do agente")}
        <select
          className="min-w-[15rem] flex-1 rounded-xl border border-border/60 bg-background px-3 py-2 text-sm font-normal sm:max-w-md"
          aria-label={t("Modo de operação")}
          value={agent.operation_mode ?? "automatic"}
          disabled={readOnly || busy}
          onChange={(e) => change({ operation_mode: e.target.value })}
        >
          <option value="assisted">{t("Assistido: revisar antes de enviar")}</option>
          <option value="automatic">{t("Automático: responder com as regras do agente")}</option>
        </select>
      </label>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="rounded-xl"
        disabled={readOnly || busy || !agent.published_version_id}
        onClick={() => change({ paused_at: agent.paused_at ? null : new Date().toISOString() })}
      >
        {t(agent.paused_at ? "Retomar automático" : "Pausar automático")}
      </Button>
      <p className="w-full border-t border-border/50 pt-3 text-xs leading-relaxed text-muted-foreground">
        {t(
          agent.paused_at
            ? "Automático pausado. A versão publicada foi preservada e a assistência continua disponível."
            : "O modo assistido prepara sugestões na conversa. Só a aprovação humana autoriza o envio.",
        )}
      </p>
    </section>
  );
}
