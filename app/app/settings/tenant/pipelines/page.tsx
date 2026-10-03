import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { PipelinesClient, type PipelineRow } from "./_client";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

/**
 * ⚠️ A PÁGINA É manager+, O EDITOR DE VOCABULÁRIO CONTINUA admin.
 *
 * O mapeamento do funil do agente mora aqui, e a rota que o grava exige manager
 * — é configuração de operação, não de estrutura da empresa. O Painel de
 * Evolução (também manager+) manda o dono da operação para cá quando aponta a
 * lacuna; se a página seguisse admin-only, o CTA levaria metade dos usuários
 * autorizados a um 403 e o ciclo "vejo o problema → conserto" morreria no meio.
 *
 * O editor de vocabulário/custom fields NÃO afrouxou: `updatePipelineConfig`
 * continua recusando quem não é admin no servidor, e a UI dele só é renderizada
 * para admin — esconder o que a ação recusaria é honestidade, não permissão nova.
 */
export default async function PipelinesSettingsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }
  const podeEditarConfig =
    (user.is_platform_admin && !user.support) || ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin;

  const supabase = await createClient();
  const { data } = await supabase
    .from("crm_pipelines")
    .select("id, name, slug, vocabulary, settings")
    .eq("organization_id", activeOrg.orgId)
    .eq("is_archived", false)
    .order("position");

  const pipelines = (data ?? []) as PipelineRow[];
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
            {traduzir("Estrutura comercial", idioma)}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.045em] sm:text-[2rem]">
            {traduzir("Etapas do funil", idioma)}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {traduzir(
              "Organize as colunas do funil e defina para onde a IA move cada negócio ao longo do atendimento.",
              idioma,
            )}
          </p>
          {podeEditarConfig && (
            <p className="mt-1 text-xs text-muted-foreground">
              {traduzir(
                "Administradores também podem ajustar vocabulário, campos personalizados e motivos de perda.",
                idioma,
              )}
            </p>
          )}
        </div>
      </header>
      <PipelinesClient pipelines={pipelines} podeEditarConfig={podeEditarConfig} />
    </div>
  );
}
