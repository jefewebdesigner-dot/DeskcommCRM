export interface ContextoFinanceiroDaResposta {
  source?: string | null;
  statusPagamento?: string | null;
  renovaEm?: string | null;
}

export interface ContextoTarefaDaResposta {
  title: string;
}

export interface ContextoCompromissoDaResposta {
  status: string;
  outcomeRecordedAt?: string | null;
}

export interface ContextoNegocioDaResposta {
  status: string;
  source?: string | null;
  etapaNome?: string | null;
  lastActivityAt?: string | null;
  updatedAt?: string | null;
  closedAt?: string | null;
}

export interface SugestaoRespostaRapida {
  shortcut: string;
  motivo: string;
  prioridade: number;
}

function normaliza(valor: string | null | undefined): string {
  return (valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function horasDesde(iso: string | null | undefined, agora: Date): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return (agora.getTime() - ms) / 3_600_000;
}

function diasAte(iso: string | null | undefined, agora: Date): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return (ms - agora.getTime()) / 86_400_000;
}

/**
 * Escolhe UMA resposta para sugerir, sem enviar nada automaticamente.
 *
 * A prioridade é deliberadamente conservadora: cobrança e falta têm fato
 * objetivo; tarefas explícitas vêm depois; estágio de proposta só sugere
 * follow-up quando já esfriou. A função nunca inventa contexto a partir de uma
 * palavra solta de conversa.
 */
export function inferirSugestaoRespostaRapida(input: {
  agora: Date;
  financeiros: ContextoFinanceiroDaResposta[];
  tarefasAbertas: ContextoTarefaDaResposta[];
  compromissosRecentes: ContextoCompromissoDaResposta[];
  negocios: ContextoNegocioDaResposta[];
}): SugestaoRespostaRapida | null {
  const atrasado = input.financeiros.some(
    (f) => normaliza(f.statusPagamento) === "atrasado",
  );
  if (atrasado) {
    return {
      shortcut: "cobranca",
      motivo: "Há uma pendência financeira registrada para este cliente.",
      prioridade: 100,
    };
  }

  const faltouRecentemente = input.compromissosRecentes.some((c) => {
    if (c.status !== "no_show") return false;
    const horas = horasDesde(c.outcomeRecordedAt, input.agora);
    return horas !== null && horas >= 0 && horas <= 24;
  });
  if (faltouRecentemente) {
    return {
      shortcut: "faltou",
      motivo: "O cliente faltou a um compromisso nas últimas 24 horas.",
      prioridade: 90,
    };
  }

  const tarefas = input.tarefasAbertas.map((t) => normaliza(t.title));
  const porTarefa: Array<[RegExp, string, string, number]> = [
    [/onboarding|implantacao/, "onboarding", "Há uma tarefa de onboarding/implantação em aberto.", 85],
    [/enviar proposta|preparar proposta/, "proposta", "Há uma tarefa de proposta em aberto.", 82],
    [/follow.?up|retorno.*proposta|cobrar.*proposta/, "followup", "Há um follow-up comercial em aberto.", 80],
    [/pos.?venda|acompanhar cliente/, "posvenda", "Há uma tarefa de pós-venda em aberto.", 75],
  ];
  for (const [padrao, shortcut, motivo, prioridade] of porTarefa) {
    if (tarefas.some((titulo) => padrao.test(titulo))) {
      return { shortcut, motivo, prioridade };
    }
  }

  const venceLogo = input.financeiros.some((f) => {
    if (normaliza(f.statusPagamento) !== "ativo") return false;
    const dias = diasAte(f.renovaEm, input.agora);
    return dias !== null && dias >= 0 && dias <= 3;
  });
  if (venceLogo) {
    return {
      shortcut: "vence",
      motivo: "A próxima renovação/fatura vence nos próximos 3 dias.",
      prioridade: 70,
    };
  }

  const propostaEsfriou = input.negocios.some((n) => {
    if (n.status !== "open" || !normaliza(n.etapaNome).includes("proposta")) return false;
    const horas = horasDesde(n.lastActivityAt ?? n.updatedAt, input.agora);
    return horas !== null && horas >= 24;
  });
  if (propostaEsfriou) {
    return {
      shortcut: "followup",
      motivo: "O negócio está em etapa de proposta e está sem atividade há pelo menos 24 horas.",
      prioridade: 65,
    };
  }

  const ganhouRecentemente = input.negocios.some((n) => {
    if (n.status !== "won" || normaliza(n.source).startsWith("periciaia_billing")) return false;
    const horas = horasDesde(n.closedAt ?? n.updatedAt, input.agora);
    return horas !== null && horas >= 0 && horas <= 72;
  });
  if (ganhouRecentemente) {
    return {
      shortcut: "contratou",
      motivo: "Este negócio foi ganho recentemente e ainda está na janela de boas-vindas.",
      prioridade: 60,
    };
  }

  return null;
}
