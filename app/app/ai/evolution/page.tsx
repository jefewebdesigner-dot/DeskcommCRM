import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { EvolutionClient } from "./_client";

export const dynamic = "force-dynamic";

/**
 * O intervalo padrão nasce AQUI, no servidor, e desce como prop. Calculá-lo no
 * cliente com `new Date()` faria o render do servidor e o da hidratação
 * discordarem na virada do dia UTC — o campo de data piscaria trocando sozinho.
 * São os mesmos 30 dias que a rota assume quando não recebe filtro.
 */
function ultimosTrintaDiasUtc(): { from: string; to: string } {
  const agora = new Date();
  const fim = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()));
  const inicio = new Date(fim.getTime() - 29 * 86_400_000);
  return { from: inicio.toISOString().slice(0, 10), to: fim.toISOString().slice(0, 10) };
}

export default async function EvolutionPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }
  const idioma = user.idioma;

  return (
    <div className="flex h-full flex-col gap-5 p-4 sm:p-6">
      <header className="relative overflow-hidden rounded-[24px] border border-border/60 bg-gradient-to-br from-card via-card to-muted/35 p-5 shadow-[0_10px_32px_rgba(0,0,0,0.045)] sm:p-6">
        <div
          className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full bg-violet-500/[0.06] blur-3xl"
          aria-hidden="true"
        />
        <div className="relative">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {traduzir("Aprendizado e impacto", idioma)}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.045em] sm:text-[2rem]">
            {traduzir("Evolução da IA", idioma)}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-text-muted">
            {traduzir(
              "O que seu agente aprendeu no período, o que ele fez com isso, o que mudou no seu resultado — e o que ainda está travando.",
              idioma,
            )}
          </p>
        </div>
      </header>
      <EvolutionClient defaultRange={ultimosTrintaDiasUtc()} />
    </div>
  );
}
