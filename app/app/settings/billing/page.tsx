import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { emailDeSuporte } from "@/lib/branding/saida";
import { Card } from "@/components/ui/card";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

/**
 * A tela de dinheiro entregava o nosso contato ao cliente do revendedor, e ela
 * tem porta de 1ª classe no menu. Mesmo tratamento da tela de conta suspensa:
 * o endereço é o de quem opera a instalação (`SUPPORT_EMAIL`) e, sem ele
 * configurado, nenhum endereço aparece.
 */
export default async function BillingPage() {
  // spec 13 §4: billing é admin-only (viewer/agent/manager = none).
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg || ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }
  const suporte = await emailDeSuporte();
  const idioma = user.idioma;
  return (
    <div className="flex h-full flex-col gap-5 p-4 sm:p-6">
      <header className="relative overflow-hidden rounded-[24px] border border-border/60 bg-gradient-to-br from-card via-card to-muted/35 p-5 shadow-[0_10px_32px_rgba(0,0,0,0.045)] sm:p-6">
        <div className="relative">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {traduzir("Plano e cobrança", idioma)}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.045em] sm:text-[2rem]">
            Billing
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {traduzir("Acompanhe plano, faturas e informações de cobrança da organização.", idioma)}
          </p>
        </div>
      </header>
      <Card className="max-w-2xl rounded-[24px] border-border/60 p-6 shadow-sm">
        <h2 className="text-sm font-semibold">{traduzir("Em breve — Fase 2", idioma)}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {traduzir("Billing entra na Fase 2 do roadmap.", idioma)}{" "}
          {suporte ? (
            <>
              {traduzir("Para questões de pagamento, contate", idioma)}{" "}
              <a className="underline" href={`mailto:${suporte}`}>
                {suporte}
              </a>
              .
            </>
          ) : (
            <>
              {traduzir(
                "Para questões de pagamento, fale com quem administra este sistema.",
                idioma,
              )}
            </>
          )}
        </p>
      </Card>
    </div>
  );
}
