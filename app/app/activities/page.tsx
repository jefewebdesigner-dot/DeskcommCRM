import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";

import { ActivityReportClient } from "./_components/ActivityReportClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Atividades" };

export default async function ActivitiesReportPage() {
  const user = await requireAuth();
  // `t` local e não o hook: componente de SERVIDOR — o idioma já vem resolvido
  // pela cadeia pessoa → organização → padrão em `lib/auth/server.ts`.
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex h-full flex-col gap-5 p-4 sm:p-6">
      <header className="relative overflow-hidden rounded-[24px] border border-border/60 bg-gradient-to-br from-card via-card to-muted/35 p-5 shadow-[0_10px_32px_rgba(0,0,0,0.045)] sm:p-6">
        <div
          className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full bg-primary/[0.045] blur-3xl"
          aria-hidden="true"
        />
        <div className="relative">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {t("Ritmo da operação")}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.045em] sm:text-[2rem]">
            {t("Atividades")}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t("O que aconteceu na operação no período — e quanto disso foi a equipe.")}
          </p>
        </div>
      </header>

      <ActivityReportClient />
    </div>
  );
}
