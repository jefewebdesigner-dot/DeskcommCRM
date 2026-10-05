"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { formatCents, MOEDA_PADRAO } from "@/lib/money";
import type { Lead } from "@/lib/types/leads";
import type { TipoOperacionalDoFunil } from "@/lib/pipelines/funis-operacionais";
import { ArrowRight } from "@/lib/ui/icons";

export interface ResumoOperacionalDoFunil {
  abertos: number;
  emRisco: number;
  semResponsavel: number;
  prazoVencido: number;
  valores: Array<{ moeda: string; centavos: number }>;
}

/**
 * As cinco perguntas que o topo do funil precisa responder sem reimplementar o
 * Radar nem a lógica dos cards: quantos, quanto vale, quantos estão em risco,
 * quantos estão sem dono e quantos já estouraram a data combinada.
 */
export function resumirFunil(
  leads: Lead[],
  idsEmRisco: ReadonlySet<string>,
  agora = new Date(),
): ResumoOperacionalDoFunil {
  const abertos = leads.filter((lead) => lead.status === "open");
  const hoje = agora.toISOString().slice(0, 10);
  const porMoeda = new Map<string, number>();

  for (const lead of abertos) {
    if (lead.value_cents == null) continue;
    const moeda = lead.currency ?? MOEDA_PADRAO;
    porMoeda.set(moeda, (porMoeda.get(moeda) ?? 0) + lead.value_cents);
  }

  return {
    abertos: abertos.length,
    emRisco: abertos.filter((lead) => idsEmRisco.has(lead.id)).length,
    // Três formas de "tem dono": login direto (owner_user_id, modelo antigo),
    // agente de IA (owner_agent_id), ou perfil operacional compartilhado
    // (responsible_profile_id — Jeferson/Luan com o mesmo login). Contar só as
    // duas primeiras fazia TODO negócio aparecer "sem responsável" numa
    // instalação que usa perfis: 338 de 338, quando na real só 12 estavam sem
    // nenhum dos três.
    semResponsavel: abertos.filter(
      (lead) =>
        lead.owner_user_id === null &&
        lead.owner_agent_id === null &&
        !lead.responsible_profile_id,
    ).length,
    prazoVencido: abertos.filter((lead) =>
      Boolean(lead.expected_close_date && lead.expected_close_date < hoje),
    ).length,
    valores: [...porMoeda.entries()]
      .map(([moeda, centavos]) => ({ moeda, centavos }))
      .sort((a, b) => a.moeda.localeCompare(b.moeda)),
  };
}

function valorDoFunil(valores: ResumoOperacionalDoFunil["valores"]): string {
  if (valores.length === 0) return "—";
  return valores.map(({ moeda, centavos }) => formatCents(centavos, moeda)).join(" + ");
}

export function ResumoOperacionalDoFunil({
  leads,
  idsEmRisco,
  tipoOperacional,
  onSemResponsavel,
  onPrazoVencido,
}: {
  leads: Lead[];
  idsEmRisco: ReadonlySet<string>;
  tipoOperacional: TipoOperacionalDoFunil | null;
  onSemResponsavel: () => void;
  onPrazoVencido: () => void;
}) {
  const t = useT();
  const resumo = resumirFunil(leads, idsEmRisco);
  const primeiroTitulo =
    tipoOperacional === "post_sales"
      ? "Clientes em acompanhamento"
      : tipoOperacional === "support"
        ? "Chamados abertos"
        : tipoOperacional === "retention"
          ? "Casos em recuperação"
          : "Negócios abertos";
  const primeiroAjuda =
    tipoOperacional === "post_sales"
      ? "Clientes que ainda têm uma etapa de pós-venda em andamento."
      : tipoOperacional === "support"
        ? "Chamados que ainda precisam de atendimento ou validação."
        : tipoOperacional === "retention"
          ? "Clientes em cobrança, negociação ou retenção."
          : "O que ainda pode avançar neste funil.";
  const valorTitulo =
    tipoOperacional === "post_sales"
      ? "Valor acompanhado"
      : tipoOperacional === "retention"
        ? "Valor em recuperação"
        : "Valor em negociação";
  const mostraValor = tipoOperacional !== "support";

  return (
    <section
      className="space-y-2"
      aria-label={t("Visão operacional do funil")}
      data-testid="resumo-do-funil"
    >
      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-5">
        <div className="min-w-0 rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm sm:p-4">
          <p className="text-[10px] font-semibold tracking-[0.10em] text-muted-foreground uppercase">
            {t(primeiroTitulo)}
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.035em] tabular-nums">
            {resumo.abertos}
          </p>
          <p className="mt-1 text-[10px] leading-snug text-muted-foreground sm:text-[11px]">{t(primeiroAjuda)}</p>
        </div>

        {mostraValor ? (
          <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
            <p className="text-[10px] font-semibold tracking-[0.10em] text-muted-foreground uppercase">
              {t(valorTitulo)}
            </p>
            <p
              className="mt-1 truncate text-xl font-semibold tabular-nums"
              title={valorDoFunil(resumo.valores)}
            >
              {valorDoFunil(resumo.valores)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t(
                tipoOperacional === "retention"
                  ? "Valor financeiro dos casos ainda em recuperação."
                  : "Soma dos negócios ainda abertos.",
              )}
            </p>
          </div>
        ) : null}

        <div className="min-w-0 rounded-2xl border border-warning/20 bg-warning-bg/35 p-3.5 shadow-sm sm:p-4">
          <p className="text-[10px] font-semibold tracking-[0.10em] text-muted-foreground uppercase">
            {t("Em risco")}
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.035em] tabular-nums">
            {resumo.emRisco}
          </p>
          <Button asChild variant="ghost" size="sm" className="mt-1 h-6 px-0 text-xs">
            <Link href="/app/radar">
              {t("Abrir Radar")} <ArrowRight size={12} aria-hidden />
            </Link>
          </Button>
        </div>

        <button
          type="button"
          onClick={onSemResponsavel}
          className="min-w-0 rounded-2xl border border-border/60 bg-card p-3.5 text-left shadow-sm transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-md sm:p-4"
        >
          <p className="text-[10px] font-semibold tracking-[0.10em] text-muted-foreground uppercase">
            {t("Sem responsável")}
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.035em] tabular-nums">
            {resumo.semResponsavel}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("Clique para filtrar e distribuir.")}
          </p>
        </button>

        <button
          type="button"
          onClick={onPrazoVencido}
          className="min-w-0 rounded-2xl border border-warning/20 bg-warning-bg/25 p-3.5 text-left shadow-sm transition-[border-color,box-shadow] hover:border-warning/35 hover:shadow-md sm:p-4"
        >
          <p className="text-[10px] font-semibold tracking-[0.10em] text-muted-foreground uppercase">
            {t("Prazo vencido")}
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.035em] tabular-nums">
            {resumo.prazoVencido}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("Clique para ver o que já passou da data.")}
          </p>
        </button>
      </div>
    </section>
  );
}
