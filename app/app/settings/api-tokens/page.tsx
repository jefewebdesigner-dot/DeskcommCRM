import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { ApiTokensClient } from "./_components/ApiTokensClient";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

export default async function ApiTokensPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg || ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }
  const idioma = user.idioma;

  return (
    <div className="flex h-full flex-col gap-5 p-4 sm:p-6">
      <header className="relative overflow-hidden rounded-[24px] border border-border/60 bg-gradient-to-br from-card via-card to-muted/35 p-5 shadow-[0_10px_32px_rgba(0,0,0,0.045)] sm:p-6">
        <div className="relative">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {traduzir("Integração segura", idioma)}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.045em] sm:text-[2rem]">
            API Tokens
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {traduzir("Tokens server-to-server. Plaintext exibido", idioma)}{" "}
            <strong>{traduzir("uma única vez", idioma)}</strong> {traduzir("na criação.", idioma)}
          </p>
        </div>
      </header>
      <ApiTokensClient />
    </div>
  );
}
