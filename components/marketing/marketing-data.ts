// Conteúdo do site de venda do Gravity CRM.
//
// Cada promessa aqui corresponde a um módulo que existe no produto (conferido
// em 2026-10-12): menu por setor, Inbox com agentes de IA, funis/tarefas/agenda/
// radar, Operação SaaS (Customer 360, saúde, Action Center, retenção), Revenue
// OS, Meta Ads, Nuvemshop, API/webhooks e pedidos LGPD. Não acrescente
// depoimento, número de resultado ou integração que não seja real e autorizado.

export type Pillar = { title: string; text: string };

export const pillars: Pillar[] = [
  {
    title: "Organizado por setor",
    text: "Vendas, Customer Success, Suporte e Receita, cada time no seu espaço — e todos olhando o mesmo cliente, sem planilha paralela.",
  },
  {
    title: "WhatsApp com agentes de IA",
    text: "Os agentes de IA atendem, qualificam e chamam a sua equipe quando a conversa pede uma pessoa. Tudo fica registrado no histórico do contato.",
  },
  {
    title: "Funis, tarefas e agenda",
    text: "Funis por etapa, tarefas com prazo, agenda com link público de agendamento e um radar dos leads que estão esfriando.",
  },
  {
    title: "Customer Success de verdade",
    text: "Visão 360 de cada cliente, saúde da base e uma central de ações para agir antes do cancelamento — não depois.",
  },
  {
    title: "Receita recorrente à vista",
    text: "MRR, churn, expansão e retenção calculados a partir das assinaturas, num painel que o dono entende.",
  },
  {
    title: "Integrações e LGPD",
    text: "API e webhooks, Meta Ads e Nuvemshop. Dados isolados por empresa e pedidos de titular (LGPD) tratados dentro da plataforma.",
  },
];

export type Segment = {
  id: string;
  label: string;
  title: string;
  text: string;
  bullets: string[];
};

export const segments: Segment[] = [
  {
    id: "saas",
    label: "Empresas por assinatura",
    title: "Vende bem, mas descobre o cancelamento quando já aconteceu?",
    text: "Do primeiro contato à renovação: o comercial no funil, o suporte no WhatsApp e o Customer Success acompanhando a saúde de cada cliente.",
    bullets: [
      "Customer 360 e saúde da base",
      "Central de ações para quem está em risco",
      "MRR, churn e retenção por período",
    ],
  },
  {
    id: "clinicas",
    label: "Clínicas e consultórios",
    title: "Mensagem sem resposta e paciente desistindo da consulta?",
    text: "O agente de IA responde na hora, tira as dúvidas e marca no horário livre — a recepção cuida de quem já está sendo atendido.",
    bullets: [
      "Agendamento pela conversa e por link público",
      "Lembrete do compromisso marcado",
      "Histórico do paciente no mesmo lugar",
    ],
  },
  {
    id: "servicos",
    label: "Serviços profissionais",
    title: "Contato novo esfriando enquanto ninguém responde?",
    text: "Para escritórios, perícia e consultorias: a IA faz a triagem inicial e só passa para você quem já está pronto para conversar.",
    bullets: [
      "Triagem inicial pelo agente de IA",
      "Funil por tipo de caso",
      "Radar de quem está esfriando",
    ],
  },
  {
    id: "lojas",
    label: "Lojas",
    title: "Cliente perguntando preço e ninguém responde a tempo?",
    text: "O agente consulta o catálogo e responde preço e disponibilidade na conversa; quem vende entra no fechamento.",
    bullets: [
      "Catálogo de produtos consultado pela IA",
      "Integração com Nuvemshop",
      "Funil de vendas pelo WhatsApp",
    ],
  },
];

export type ComparisonRow = { criterio: string; mercado: string; gravit: string };

export const comparisonRows: ComparisonRow[] = [
  {
    criterio: "Organização",
    mercado: "Uma ferramenta para vender, outra para suporte, outra para cobrança",
    gravit: "Vendas, Customer Success, Suporte e Receita no mesmo lugar, por setor",
  },
  {
    criterio: "Atendimento",
    mercado: "Chatbot de fluxograma",
    gravit: "Agentes de IA que entendem o contexto e chamam a equipe quando precisa",
  },
  {
    criterio: "Gestão comercial",
    mercado: "Funil em planilha ou sem funil",
    gravit: "Funis, tarefas, agenda e radar de leads esfriando",
  },
  {
    criterio: "Pós-venda",
    mercado: "Só se descobre o cancelamento quando acontece",
    gravit: "Saúde da base e central de ações para agir antes",
  },
  {
    criterio: "Implantação",
    mercado: "Sozinho, por tutorial",
    gravit: "Conduzida pela nossa equipe",
  },
  {
    criterio: "Dados",
    mercado: "Espalhados em planilhas e exportações",
    gravit: "Isolados por empresa, com LGPD dentro da plataforma",
  },
];

export type Plan = {
  name: string;
  tagline: string;
  price: string;
  period: string;
  highlighted?: boolean;
  features: string[];
};

// Limites iguais aos de lib/saas/limites-do-plano.ts (standard / pro / enterprise).
export const plans: Plan[] = [
  {
    name: "Básico",
    tagline: "Para começar a organizar vendas e atendimento",
    price: "R$ 99,90",
    period: "/mês",
    features: [
      "2 usuários",
      "1 número de WhatsApp",
      "Inbox com agentes de IA",
      "Funis, tarefas e agenda",
      "Customer Success e Receita",
    ],
  },
  {
    name: "Pro",
    tagline: "Para o time inteiro, por setor",
    price: "Por usuário",
    period: "",
    highlighted: true,
    features: [
      "Até 10 usuários",
      "Até 3 números de WhatsApp",
      "Tudo do Básico",
      "Automações e follow-ups",
      "Implantação conduzida pela equipe",
    ],
  },
  {
    name: "Enterprise",
    tagline: "Para operações maiores",
    price: "Sob consulta",
    period: "",
    features: [
      "Usuários e números sem limite",
      "Tudo do Pro",
      "Integrações sob medida",
      "Acompanhamento dedicado",
    ],
  },
];

export type Faq = { q: string; a: string };

export const faqs: Faq[] = [
  {
    q: "O que é o Gravity CRM?",
    a: "Um CRM brasileiro, organizado por setor — Vendas, Customer Success, Suporte e Receita —, com atendimento no WhatsApp por agentes de IA.",
  },
  {
    q: "Em que a IA é diferente de um chatbot?",
    a: "Chatbot segue fluxograma fixo. Os agentes do Gravity CRM entendem o contexto da conversa, consultam o que você ensinou a eles e passam para uma pessoa da equipe quando a conversa pede.",
  },
  {
    q: "Preciso de conhecimento técnico?",
    a: "Não. A implantação e a conexão do WhatsApp são feitas junto com a nossa equipe.",
  },
  {
    q: "Integra com o que eu já uso?",
    a: "Sim: API e webhooks para qualquer sistema, além de Meta Ads e Nuvemshop.",
  },
  {
    q: "Meus dados estão seguros?",
    a: "Cada empresa tem os dados isolados das demais, e os pedidos de titular previstos na LGPD são tratados dentro da plataforma.",
  },
];
