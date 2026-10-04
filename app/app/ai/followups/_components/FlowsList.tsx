"use client";

import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";

import { useT } from "@/hooks/i18n/useT";
import { useMemo, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FlowArrow, Plus, Sparkle } from "@/lib/ui/icons";
import { useFollowupFlows, type FollowupFlowPointerRow } from "@/hooks/followup/useFollowupFlows";
import { DeleteFollowupFlowButton } from "./DeleteFollowupFlowButton";
import { FlowStatusBadge } from "./FlowStatusBadge";
import { ModelosDialog } from "./ModelosDialog";
import { NewFlowDialog } from "./NewFlowDialog";

interface Props {
  initialData: FollowupFlowPointerRow[];
  canWrite: boolean;
}

const HANDOFF_LABEL: Record<string, string> = {
  pause: "Pausa enquanto um humano atende",
  cancel: "Encerra quando um humano assume",
  allow: "Continua mesmo com atendimento humano",
};

function formatUpdatedAt(iso: string, idioma: string): string {
  return new Date(iso).toLocaleDateString(idioma, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function FlowsList({ initialData, canWrite }: Props) {
  const tagDoIdioma = useTagDeIdioma();
  const t = useT();
  const { data } = useFollowupFlows({ initialData });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [modelosOpen, setModelosOpen] = useState(false);

  const flows = useMemo(() => data ?? [], [data]);
  const resumo = useMemo(
    () => ({
      ativos: flows.filter((f) => f.status === "active").length,
      rascunhos: flows.filter((f) => f.status === "draft").length,
      desativados: flows.filter((f) => f.status === "disabled").length,
    }),
    [flows],
  );

  // ⚠️ "Começar de um modelo" vem ANTES de "Novo fluxo", e na tela vazia é o
  // botão cheio. Quem chega aqui numa instalação nova não sabe o que é nó, ramo
  // ou prazo de graça — mandá-lo para uma tela em branco é o caminho mais curto
  // para a clínica nunca ter follow-up nenhum. Desenhar do zero continua a um
  // clique, para quem já sabe o que quer.
  const modelosButton = (
    <Button onClick={() => setModelosOpen(true)} className="w-full rounded-xl sm:w-auto">
      <Sparkle size={14} aria-hidden className="mr-2" /> {t("Começar de um modelo")}
    </Button>
  );

  const newFlowButton = (
    <Button
      onClick={() => setDialogOpen(true)}
      variant="outline"
      className="w-full rounded-xl sm:w-auto"
    >
      <Plus size={14} aria-hidden className="mr-2" /> Novo fluxo
    </Button>
  );

  const dialogos = canWrite && (
    <>
      <NewFlowDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <ModelosDialog
        open={modelosOpen}
        onOpenChange={setModelosOpen}
        nomesExistentes={flows.map((f) => f.name)}
      />
    </>
  );

  if (flows.length === 0) {
    return (
      <>
        <Card className="flex flex-col items-center gap-3 rounded-[24px] border-border/60 bg-muted/[0.06] p-10 text-center shadow-sm">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent"
            aria-hidden="true"
          >
            <FlowArrow size={24} weight="duotone" />
          </span>
          <h2 className="font-semibold tracking-tight">{t("Nenhum fluxo de follow-up ainda")}</h2>
          <p className="max-w-sm text-sm text-text-muted">
            {t(
              "Follow-ups reengajam contatos após silêncio, mudança de etapa, uma regra em Webhooks ou a resposta do contato — sem depender de alguém lembrar de mandar mensagem.",
            )}
          </p>
          {canWrite && (
            <div className="mt-1 flex flex-col items-center gap-2 sm:flex-row">
              {modelosButton}
              {newFlowButton}
            </div>
          )}
        </Card>
        {dialogos}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-3 gap-2 sm:gap-3" aria-label={t("Resumo dos follow-ups")}>
        {[
          { label: t("Ativos"), value: resumo.ativos, helper: t("em operação") },
          { label: t("Rascunhos"), value: resumo.rascunhos, helper: t("aguardando publicação") },
          { label: t("Desativados"), value: resumo.desativados, helper: t("fora da operação") },
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

      {canWrite && (
        <div className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-card p-2.5 shadow-sm sm:flex-row sm:justify-end">
          {modelosButton}
          {newFlowButton}
        </div>
      )}

      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {flows.map((flow) => (
          <li key={flow.id}>
            <Card className="group flex h-full flex-col gap-3 rounded-2xl border-border/60 p-4 shadow-sm transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md">
              <Link href={`/app/ai/followups/${flow.id}`} className="flex flex-1 flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <h3
                    className="min-w-0 flex-1 truncate font-semibold tracking-[-0.02em]"
                    title={flow.name}
                  >
                    {flow.name}
                  </h3>
                  <FlowStatusBadge status={flow.status} />
                </div>
                <dl className="grid grid-cols-2 gap-2 rounded-xl bg-muted/[0.22] p-3 text-xs">
                  <div>
                    <dt className="text-[10px] font-semibold tracking-[0.08em] text-text-muted uppercase">
                      {t("Versão")}
                    </dt>
                    <dd className="mt-1 font-medium">
                      {flow.active_version_id ? t("Publicada") : t("Ainda não publicada")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-semibold tracking-[0.08em] text-text-muted uppercase">
                      {t("Ao assumir")}
                    </dt>
                    <dd className="mt-1 leading-snug font-medium">
                      {t(HANDOFF_LABEL[flow.handoff_policy] ?? flow.handoff_policy)}
                    </dd>
                  </div>
                </dl>
                <p className="mt-auto pt-2 text-[11px] text-text-muted">
                  {t("Atualizado em")} {formatUpdatedAt(flow.updated_at, tagDoIdioma)}
                </p>
              </Link>
              {canWrite && (
                <div className="flex justify-end border-t border-border/60 pt-2">
                  <DeleteFollowupFlowButton flowId={flow.id} flowName={flow.name} />
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>

      {dialogos}
    </div>
  );
}
