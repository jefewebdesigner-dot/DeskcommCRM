export interface RespostaRapidaSugerida {
  title: string;
  shortcut: string;
  body: string;
  objetivo: string;
}

/**
 * Biblioteca inicial do fluxo comercial/operacional.
 *
 * Não cita PeríciaIA de propósito: `{{empresa}}` resolve para a organização
 * ativa no Inbox, então o mesmo pacote pode ser instalado em outro cliente sem
 * carregar marca ou texto de um tenant para outro.
 */
export const RESPOSTAS_RAPIDAS_SUGERIDAS: RespostaRapidaSugerida[] = [
  {
    title: "Primeiro contato",
    shortcut: "inicio",
    objetivo: "Abrir a conversa e entender a necessidade do interessado.",
    body:
      "Oi {{primeiro_nome}}, tudo bem? Aqui é da {{empresa}}. Vi seu interesse e quero entender melhor o que você precisa para te orientar da forma mais adequada.",
  },
  {
    title: "Enviar proposta",
    shortcut: "proposta",
    objetivo: "Acompanhar o envio da proposta com um próximo passo claro.",
    body:
      "Oi {{primeiro_nome}}, preparei a proposta conforme conversamos. Se quiser, posso te explicar os pontos principais e alinhar com você os próximos passos.",
  },
  {
    title: "Follow-up da proposta",
    shortcut: "followup",
    objetivo: "Retomar uma proposta sem resposta sem soar como mensagem automática.",
    body:
      "Oi {{primeiro_nome}}, passando para saber se conseguiu analisar a proposta. Ficou alguma dúvida ou existe algum ponto que eu possa ajustar com você?",
  },
  {
    title: "Boas-vindas e onboarding",
    shortcut: "onboarding",
    objetivo: "Dar início à implantação logo depois da contratação.",
    body:
      "Oi {{primeiro_nome}}, seja bem-vindo(a) à {{empresa}}. Vamos iniciar sua implantação e eu vou te acompanhar nos próximos passos para deixar tudo funcionando corretamente.",
  },
  {
    title: "Plano contratado",
    shortcut: "contratou",
    objetivo: "Confirmar a contratação e levar o cliente imediatamente para o onboarding.",
    body:
      "Oi {{primeiro_nome}}, sua contratação com a {{empresa}} foi confirmada. Seja bem-vindo(a)! Vou te acompanhar agora nos próximos passos para iniciarmos sua implantação.",
  },
  {
    title: "Fatura próxima do vencimento",
    shortcut: "vence",
    objetivo: "Lembrar o cliente antes do vencimento sem tratar como inadimplente.",
    body:
      "Oi {{primeiro_nome}}, tudo bem? Passando para lembrar que sua próxima fatura da {{empresa}} vence em breve. Se precisar dos dados de pagamento ou tiver alguma dúvida, posso te ajudar por aqui.",
  },
  {
    title: "Cobrança cordial",
    shortcut: "cobranca",
    objetivo: "Abrir uma conversa de cobrança sem partir direto para uma mensagem agressiva.",
    body:
      "Oi {{primeiro_nome}}, tudo bem? Identificamos uma pendência financeira no seu cadastro. Posso te enviar os dados para regularização ou verificar alguma dúvida sobre a cobrança?",
  },
  {
    title: "Pagamento confirmado",
    shortcut: "pagamento",
    objetivo: "Confirmar a regularização e encerrar o ciclo de cobrança com clareza.",
    body:
      "Oi {{primeiro_nome}}, confirmamos seu pagamento. Está tudo certo por aqui. Obrigado! Se precisar de qualquer coisa com a {{empresa}}, seguimos à disposição.",
  },
  {
    title: "Cliente faltou ao compromisso",
    shortcut: "faltou",
    objetivo: "Retomar rapidamente um cliente que não compareceu e definir nova ação.",
    body:
      "Oi {{primeiro_nome}}, notei que não conseguimos nos encontrar no horário combinado. Quer que eu te envie algumas opções para remarcarmos?",
  },
  {
    title: "Pós-venda",
    shortcut: "posvenda",
    objetivo: "Validar experiência, detectar problema e abrir oportunidade de retenção.",
    body:
      "Oi {{primeiro_nome}}, passando para saber como está sua experiência com a {{empresa}}. Está tudo funcionando como esperado? Se houver algum ponto para melhorar, pode me contar por aqui.",
  },
];

export function respostaSugeridaPorAtalhoOuTitulo(input: {
  shortcut?: string | null;
  title: string;
}): RespostaRapidaSugerida | null {
  const atalho = input.shortcut?.trim().toLowerCase() ?? "";
  const titulo = input.title.trim().toLowerCase();
  return (
    RESPOSTAS_RAPIDAS_SUGERIDAS.find(
      (sugestao) =>
        (atalho !== "" && sugestao.shortcut.toLowerCase() === atalho) ||
        sugestao.title.toLowerCase() === titulo,
    ) ?? null
  );
}
