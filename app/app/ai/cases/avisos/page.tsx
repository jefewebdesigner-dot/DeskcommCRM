/**
 * IA › Acompanhar o agente › **Aviso no WhatsApp** (`/app/ai/cases/avisos`).
 *
 * ## Por que aqui e não em Configurações
 *
 * Configurações › Atendimento é `manager` e trata de rodízio e visibilidade.
 * Esta tela é `admin` porque escolhe um número conectado e manda dado de
 * cliente para um celular — misturar os dois papéis numa página só faria o gate
 * de papel virar detalhe de componente. E não é uma aba de Conexões porque
 * Conexões é POR conexão; esta configuração é da organização e fala de casos.
 *
 * ## O rótulo é "Aviso no WhatsApp", nunca "Avisos"
 *
 * "Alertas" já é a Central, na MESMA seção deste menu, e todo o vocabulário
 * interno dela é "aviso" (`POLITICAS_DE_AVISO`, `REFERENCIAS_DE_AVISO`). Para
 * quem não programa, "Avisos" ao lado de "Alertas" é a mesma palavra duas
 * vezes. O rótulo nomeia o CANAL e o destinatário.
 *
 * ## `metadata.title` declarado
 *
 * Sem ele a aba herda o título default do `app/layout.tsx`, que é a frase de
 * venda inteira da landing. `tests/e2e/qa-titulos-das-telas.spec.ts` mede isso
 * por ferramenta (`page.title()`), e esta rota entrou na lista dele.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { AvisoNoWhatsApp } from "./_components/AvisoNoWhatsApp";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Aviso no WhatsApp" };

export default async function AvisoDeCasoPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  // O MESMO gate da rota (`requireRole("admin")`) e da RLS de
  // `config_aviso_de_caso`. Mostrar a tela a quem a API recusa seria oferecer
  // um formulário que nunca salva.
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }
  const idioma = user.idioma;

  return (
    <div className="flex h-full flex-col gap-5 p-4 sm:p-6">
      <header className="relative overflow-hidden rounded-[24px] border border-border/60 bg-gradient-to-br from-card via-card to-muted/35 p-5 shadow-[0_10px_32px_rgba(0,0,0,0.045)] sm:p-6">
        <div
          className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full bg-emerald-500/[0.06] blur-3xl"
          aria-hidden="true"
        />
        <div className="relative">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {traduzir("Escalonamento humano", idioma)}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.045em] sm:text-[2rem]">
            {traduzir("Aviso no WhatsApp", idioma)}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {traduzir(
              "Receba no WhatsApp quando a IA travar em algo que precisa de uma pessoa — e acompanhe se os avisos realmente estão chegando.",
              idioma,
            )}
          </p>
        </div>
      </header>
      <AvisoNoWhatsApp />
    </div>
  );
}
