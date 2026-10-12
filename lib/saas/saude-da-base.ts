import type { HealthBand, SaaSCustomer } from "@/lib/saas/customer360";

// Saúde da base no formato do Gravity CRM (crm.ia): distribuição por faixa,
// cobertura de telemetria e a lista filtrável. Funções puras — a página só desenha.

export const FAIXAS: { id: HealthBand; label: string; variant: "success" | "warning" | "error" | "neutral" }[] = [
  { id: "critical", label: "Crítico", variant: "error" },
  { id: "high_risk", label: "Risco alto", variant: "error" },
  { id: "attention", label: "Atenção", variant: "warning" },
  { id: "healthy", label: "Saudável", variant: "success" },
  { id: "insufficient_data", label: "Sem dados de uso", variant: "neutral" },
];

export function distribuicaoDeSaude(items: SaaSCustomer[]) {
  return FAIXAS.map((f) => {
    const daFaixa = items.filter((c) => c.healthBand === f.id);
    return { ...f, clientes: daFaixa.length, mrrCents: daFaixa.reduce((n, c) => n + c.mrrCents, 0) };
  });
}

/** Quantos clientes pagantes têm uso do produto chegando (sem isso a saúde só enxerga cobrança). */
export function coberturaDeUso(items: SaaSCustomer[]) {
  const pagantes = items.filter((c) => c.status !== "churned");
  const comUso = pagantes.filter((c) => c.totalEvents > 0 && !!c.lastUseAt).length;
  return { pagantes: pagantes.length, comUso, taxa: pagantes.length ? comUso / pagantes.length : null };
}

export function filtrarPorFaixa(items: SaaSCustomer[], faixa: string | undefined): SaaSCustomer[] {
  return FAIXAS.some((f) => f.id === faixa) ? items.filter((c) => c.healthBand === faixa) : items;
}

/** Como a nota é decidida — o mesmo critério de classifyHealth, em português de quem opera. */
export const COMO_DECIDIMOS = [
  "Pagamento em atraso → Crítico: recuperar o pagamento vem antes de qualquer outra conversa.",
  "Cancelamento em andamento → Risco alto: dá tempo de intervir antes de o cliente sair.",
  "Uso nos últimos 14 dias e cobrança em dia → Saudável.",
  "Último uso entre 15 e 30 dias → Atenção; mais de 30 dias → Risco alto.",
  "Sem uso do produto conectado → Sem dados: a nota só olha a cobrança até a telemetria chegar.",
];
