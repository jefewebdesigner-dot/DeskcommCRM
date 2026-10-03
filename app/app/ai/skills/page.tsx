import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SkillsState } from "@/hooks/ai/useSkills";
import { traduzir } from "@/lib/i18n/dicionario";
import { SkillsClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  const admin = createAdminClient();

  const [{ data: orgPointers }, { data: platformPointers }] = await Promise.all([
    admin
      .from("skill_pointers")
      .select("name, version_id, updated_at")
      .eq("organization_id", activeOrg.orgId),
    admin.from("skill_pointers").select("name, version_id").is("organization_id", null),
  ]);

  const orgRows = orgPointers ?? [];
  const platformRows = platformPointers ?? [];
  const versionIds = [...new Set([...orgRows, ...platformRows].map((p) => p.version_id))];

  const { data: versionsRaw } =
    versionIds.length > 0
      ? await admin
          .from("skill_versions")
          .select("id, description, forked_from_version_id")
          .in("id", versionIds)
      : { data: [] };
  const versionById = new Map((versionsRaw ?? []).map((v) => [v.id, v]));

  const installed: SkillsState["installed"] = orgRows.map((p) => {
    const v = versionById.get(p.version_id);
    return {
      name: p.name,
      description: v?.description ?? "",
      version_id: p.version_id,
      source: (v?.forked_from_version_id ? "catalog" : "manual") as "catalog" | "manual",
      updated_at: p.updated_at,
    };
  });

  const installedNames = new Set(installed.map((i) => i.name));
  const catalog: SkillsState["catalog"] = platformRows
    .filter((p) => !installedNames.has(p.name))
    .map((p) => ({ name: p.name, description: versionById.get(p.version_id)?.description ?? "" }));

  const initialState: SkillsState = { installed, catalog };
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
            {traduzir("Capacidades do agente", idioma)}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.045em] sm:text-[2rem]">
            {traduzir("Skills da IA", idioma)}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {traduzir(
              "Adicione habilidades especializadas que os agentes carregam somente quando a conversa precisa delas.",
              idioma,
            )}
          </p>
        </div>
      </header>
      <SkillsClient initialState={initialState} />
    </div>
  );
}
