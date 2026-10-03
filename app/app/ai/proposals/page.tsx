import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { ProposalsList } from "./_components/ProposalsList";

export const dynamic = "force-dynamic";

/**
 * Propostas — as próximas ações que o assistente sugeriu, em lista.
 *
 * Antes desta tela a sugestão só existia dentro do card, no board: quem não
 * passasse naquela coluna nunca a via, e ela apodrecia sem ninguém saber que
 * havia algo para decidir. O mecanismo anti-morte morria pela mesma causa que
 * ele existe para matar.
 *
 * Decidir exige `agent` — mesmo posto que a rota de decisão cobra. Quem tem
 * menos vê a lista (saber o que a IA propôs é contexto de trabalho) e não
 * decide, em vez de não ver nada.
 */
export default async function ProposalsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const canDecide = ROLE_RANK[activeOrg.role] >= ROLE_RANK.agent;
  const idioma = user.idioma;

  return (
    <div className="flex h-full flex-col gap-5 p-4 sm:p-6">
      <header className="relative overflow-hidden rounded-[24px] border border-border/60 bg-gradient-to-br from-card via-card to-muted/35 p-5 shadow-[0_10px_32px_rgba(0,0,0,0.045)] sm:p-6">
        <div
          className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full bg-primary/[0.045] blur-3xl"
          aria-hidden="true"
        />
        <div className="relative">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {traduzir("Decisões sugeridas pela IA", idioma)}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.045em] sm:text-[2rem]">
            {traduzir("Propostas", idioma)}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {traduzir(
              "Revise os próximos passos sugeridos pela IA e decida rapidamente o que deve acontecer com cada oportunidade.",
              idioma,
            )}
          </p>
        </div>
      </header>
      <ProposalsList canDecide={canDecide} />
    </div>
  );
}
