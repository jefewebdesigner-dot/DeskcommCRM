import type { Metadata } from "next";

import { AgendamentoPublico } from "./_client";

/**
 * `/agendar/[eventTypeId]` — a página pública que substitui o link do
 * Calendly. Sem login: é o navegador do CLIENTE que chega aqui, nunca o de
 * quem administra. Fora de `app/app/**` de propósito — lá toda rota precisa
 * de porta na navegação (`tests/unit/navegacao-completude.test.ts`), e uma
 * tela pública no menu do operador seria o tipo de entrada que não deveria
 * estar lá. Fora de `app/(public)/**` também: aquele grupo é a casca de
 * ACESSO (login/cadastro/recuperação), com layout estreito (`max-w-sm`) e a
 * marca do revendedor acima do formulário — esta tela precisa de mais largura
 * para a grade de horários, e quem agenda nunca deveria ver nome de produto
 * nenhum no meio do processo. Herda só o layout raiz (fontes, tema, branding
 * da ABA, nunca do corpo — mesmo molde de `app/vitrine-agenda`).
 */
export const metadata: Metadata = {
  title: "Agendar horário",
  robots: { index: false, follow: false },
};

export default async function AgendarPage({
  params,
}: {
  params: Promise<{ eventTypeId: string }>;
}) {
  const { eventTypeId } = await params;
  return <AgendamentoPublico eventTypeId={eventTypeId} />;
}
