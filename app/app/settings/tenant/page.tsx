import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";
import { moedaServidaOu } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { ZonaDePerigoDaOrganizacao } from "./_danger-zone";
import { TenantForm } from "./_form";

export const dynamic = "force-dynamic";

interface OrgRow {
  display_name: string;
  legal_name: string;
  cnpj: string | null;
  country: string | null;
  timezone: string;
  locale: string;
  currency: string;
  media_retention_days: number;
  dpo_email: string | null;
  privacy_policy_url: string | null;
}

export default async function TenantSettingsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("organizations")
    .select(
      "display_name, legal_name, cnpj, country, timezone, locale, currency, media_retention_days, dpo_email, privacy_policy_url",
    )
    .eq("id", activeOrg.orgId)
    .maybeSingle();

  const row = (data ?? null) as OrgRow | null;
  const idioma = user.idioma;

  return (
    <div className="flex h-full flex-col gap-5 p-4 sm:p-6">
      <header className="relative overflow-hidden rounded-[24px] border border-border/60 bg-gradient-to-br from-card via-card to-muted/35 p-5 shadow-[0_10px_32px_rgba(0,0,0,0.045)] sm:p-6">
        <div className="relative">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {traduzir("Sua empresa", idioma)}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.045em] sm:text-[2rem]">
            {traduzir("Organização", idioma)}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {traduzir(
              "Dados da empresa, idioma, retenção de mídia e informações de privacidade.",
              idioma,
            )}
          </p>
        </div>
      </header>
      {row && (
        <TenantForm
          initial={{
            display_name: row.display_name,
            legal_name: row.legal_name,
            cnpj: row.cnpj,
            // `null` na coluna é Brasil (migration 0277): o seletor não tem
            // opção vazia, então o país padrão aparece EXPLÍCITO. Salvar sem
            // trocar nada grava `BR` onde estava `null` — mesmo país, mesma
            // lei, mesmo calendário; o que muda é a linha deixar de depender
            // do default implícito.
            country: row.country ?? "BR",
            timezone: row.timezone,
            // `en-US` saiu da lista (nunca teve tradução). Uma linha antiga
            // com ele cai no padrão em vez de quebrar a tela.
            locale: normalizarIdioma(row.locale),
            currency: moedaServidaOu(row.currency),
            media_retention_days: row.media_retention_days,
            dpo_email: row.dpo_email,
            privacy_policy_url: row.privacy_policy_url,
          }}
        />
      )}
      {row && <ZonaDePerigoDaOrganizacao displayName={row.display_name} />}
    </div>
  );
}
