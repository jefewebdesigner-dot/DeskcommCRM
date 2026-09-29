import type { LeadStage } from "@/lib/agent-engine/agent/lead-state";

export type TipoOperacionalDoFunil =
  | "sales"
  | "post_sales"
  | "support"
  | "retention";

export interface EtapaOperacional {
  nome: string;
  slug: string;
  hint: LeadStage | null;
  won?: boolean;
  lost?: boolean;
}

export interface FunilOperacional {
  kind: TipoOperacionalDoFunil;
  nome: string;
  descricao: string;
  rotulo: string;
  etapas: readonly EtapaOperacional[];
  motivosDePerda: readonly string[];
}

export const FUNIS_OPERACIONAIS: readonly FunilOperacional[] = [
  {
    kind: "sales",
    nome: "Vendas",
    rotulo: "Vendas",
    descricao: "Da entrada do lead ao fechamento — proposta, negociação, ganho e perda.",
    motivosDePerda: ["Preço", "Já usa outro sistema", "Não é o momento", "Sem resposta"],
    etapas: [
      { nome: "Novo lead", slug: "novo_lead", hint: "new" },
      { nome: "Primeiro contato", slug: "primeiro_contato", hint: "contacted" },
      { nome: "Qualificado", slug: "qualificado", hint: "qualifying" },
      { nome: "Demonstração agendada", slug: "demonstracao_agendada", hint: "qualified" },
      { nome: "Proposta enviada", slug: "proposta_enviada", hint: null },
      { nome: "Negociando plano", slug: "negociando_plano", hint: "negotiating" },
      { nome: "Assinante ativo", slug: "assinante_ativo", hint: "won", won: true },
      { nome: "Perdido", slug: "perdido", hint: "lost", lost: true },
    ],
  },
  {
    kind: "post_sales",
    nome: "Pós-vendas",
    rotulo: "Pós-vendas",
    descricao: "Onboarding, implantação, validação, acompanhamento e expansão do cliente ativo.",
    motivosDePerda: ["Cancelamento", "Não concluiu onboarding", "Sem retorno", "Outro"],
    etapas: [
      { nome: "Onboarding pendente", slug: "onboarding_pendente", hint: "new" },
      { nome: "Implantação", slug: "implantacao", hint: "contacted" },
      { nome: "Validação com cliente", slug: "validacao_cliente", hint: "qualifying" },
      { nome: "Cliente ativo", slug: "cliente_ativo", hint: "qualified" },
      { nome: "Acompanhamento", slug: "acompanhamento", hint: "negotiating" },
      { nome: "Expansão / Renovação", slug: "expansao_renovacao", hint: null },
      { nome: "Ciclo concluído", slug: "ciclo_concluido", hint: "won", won: true },
      { nome: "Encerrado", slug: "encerrado", hint: "lost", lost: true },
    ],
  },
  {
    kind: "support",
    nome: "Suporte",
    rotulo: "Suporte",
    descricao: "Chamados do cliente, da triagem até a validação e resolução.",
    motivosDePerda: ["Sem solução", "Fora de escopo", "Duplicado", "Cliente desistiu"],
    etapas: [
      { nome: "Novo chamado", slug: "novo_chamado", hint: "new" },
      { nome: "Triagem", slug: "triagem", hint: "contacted" },
      { nome: "Em atendimento", slug: "em_atendimento", hint: "qualifying" },
      { nome: "Aguardando cliente", slug: "aguardando_cliente", hint: null },
      { nome: "Em correção", slug: "em_correcao", hint: "qualified" },
      { nome: "Validação", slug: "validacao", hint: "negotiating" },
      { nome: "Resolvido", slug: "resolvido", hint: "won", won: true },
      { nome: "Encerrado sem solução", slug: "encerrado_sem_solucao", hint: "lost", lost: true },
    ],
  },
  {
    kind: "retention",
    nome: "Inadimplência e Retenção",
    rotulo: "Inadimplência / Retenção",
    descricao: "Vencimento, cobrança, negociação, retenção, regularização e cancelamento.",
    motivosDePerda: ["Cancelamento confirmado", "Sem resposta", "Não quis negociar", "Outro"],
    etapas: [
      { nome: "Próximo do vencimento", slug: "proximo_vencimento", hint: "new" },
      { nome: "Vencido", slug: "vencido", hint: "contacted" },
      { nome: "Contato realizado", slug: "contato_realizado", hint: "qualifying" },
      { nome: "Negociação / promessa", slug: "negociacao_promessa", hint: "qualified" },
      { nome: "Cancelamento solicitado", slug: "cancelamento_solicitado", hint: null },
      { nome: "Cancelados para recuperar", slug: "cancelados_recuperar", hint: null },
      { nome: "Retenção", slug: "retencao", hint: "negotiating" },
      { nome: "Regularizado", slug: "regularizado", hint: "won", won: true },
      { nome: "Cancelado", slug: "cancelado", hint: "lost", lost: true },
    ],
  },
] as const;

export function funilOperacional(kind: TipoOperacionalDoFunil): FunilOperacional {
  const encontrado = FUNIS_OPERACIONAIS.find((funil) => funil.kind === kind);
  if (!encontrado) throw new Error(`Funil operacional desconhecido: ${kind}`);
  return encontrado;
}

export function tipoOperacionalDoFunil(
  settings: Record<string, unknown> | null | undefined,
): TipoOperacionalDoFunil | null {
  const kind = settings?.operational_kind;
  return FUNIS_OPERACIONAIS.some((funil) => funil.kind === kind)
    ? (kind as TipoOperacionalDoFunil)
    : null;
}

export function rotuloDoTipoOperacional(kind: TipoOperacionalDoFunil | null): string | null {
  return kind ? funilOperacional(kind).rotulo : null;
}
