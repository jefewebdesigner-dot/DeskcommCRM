import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import type { CredentialRow } from "@/hooks/ai/useCredentials";
import { traduzir } from "@/lib/i18n/dicionario";
import { contarUsoQueBloqueia, type VersaoVinculada } from "@/lib/ai/credenciais/uso";
import { CredentialsList } from "./_components/CredentialsList";

export const dynamic = "force-dynamic";

const SAFE_COLUMNS =
  "id, organization_id, provider, label, api_key_last4, validated_at, validation_error, models_available, is_active, created_by, created_at, updated_at";

export default async function CredentialsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const idioma = user.idioma;
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_provider_credentials_safe")
    .select(SAFE_COLUMNS)
    .eq("organization_id", activeOrg.orgId)
    .order("created_at", { ascending: false });

  const credentials = (data ?? []) as unknown as CredentialRow[];
  const canWrite = ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin;

  // Mesma regra do DELETE — e a mesma da FK `ON DELETE RESTRICT`: TODA versão
  // que aponta para a credencial trava a exclusão, não só a publicada. O número
  // que a tela mostra é o que explica o bloqueio (ver `lib/ai/credenciais/uso.ts`).
  let usageMap: Record<string, number> = {};
  if (credentials.length > 0) {
    const { data: linked } = await supabase
      .from("ai_agent_versions")
      .select("id, credential_id, version_number, status")
      .eq("organization_id", activeOrg.orgId)
      .in(
        "credential_id",
        credentials.map((c) => c.id),
      );
    usageMap = contarUsoQueBloqueia((linked ?? []) as unknown as VersaoVinculada[]);
  }

  return (
    <div className="flex h-full flex-col gap-5 p-4 sm:p-6">
      <header className="relative overflow-hidden rounded-[24px] border border-border/60 bg-gradient-to-br from-card via-card to-muted/35 p-5 shadow-[0_10px_32px_rgba(0,0,0,0.045)] sm:p-6">
        <div
          className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full bg-primary/[0.045] blur-3xl"
          aria-hidden="true"
        />
        <div className="relative">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {traduzir("Acesso aos provedores", idioma)}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.045em] sm:text-[2rem]">
            {traduzir("Chaves de acesso à IA", idioma)}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {traduzir(
              "Conecte suas contas de IA com segurança. A chave é criptografada e nunca volta a aparecer depois de salva.",
              idioma,
            )}
          </p>
        </div>
      </header>
      <CredentialsList initialData={credentials} canWrite={canWrite} usageMap={usageMap} />
    </div>
  );
}
