import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { listSelectableChannels } from "@/lib/channels/selectable";
import { createClient } from "@/lib/supabase/server";
import type { RouterListItem } from "@/hooks/ai/useRouters";
import { traduzir } from "@/lib/i18n/dicionario";
import { RoutersClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function RoutersPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const idioma = user.idioma;

  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  const supabase = await createClient();

  const [{ data: routerRows }, { data: memberRows }, channelSessions] = await Promise.all([
    supabase
      .from("ai_routers")
      .select("id, name, channel_session_id, is_active, fallback_agent_id, updated_at")
      .eq("organization_id", activeOrg.orgId)
      .order("created_at", { ascending: false }),
    supabase.from("ai_router_members").select("router_id").eq("organization_id", activeOrg.orgId),
    listSelectableChannels(supabase, activeOrg.orgId),
  ]);

  const counts = new Map<string, number>();
  for (const m of memberRows ?? []) {
    counts.set(m.router_id, (counts.get(m.router_id) ?? 0) + 1);
  }

  const routers: RouterListItem[] = (routerRows ?? []).map((r) => ({
    ...r,
    member_count: counts.get(r.id) ?? 0,
  }));

  return (
    <div className="flex h-full flex-col gap-5 p-4 sm:p-6">
      <header className="relative overflow-hidden rounded-[24px] border border-border/60 bg-gradient-to-br from-card via-card to-muted/35 p-5 shadow-[0_10px_32px_rgba(0,0,0,0.045)] sm:p-6">
        <div
          className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full bg-primary/[0.045] blur-3xl"
          aria-hidden="true"
        />
        <div className="relative">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {traduzir("Distribuição inteligente", idioma)}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.045em] sm:text-[2rem]">
            {traduzir("Roteadores", idioma)}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {traduzir(
              "Entenda o que cada cliente quer e encaminhe a conversa para o agente certo automaticamente.",
              idioma,
            )}
          </p>
        </div>
      </header>
      <RoutersClient initialState={{ routers }} channelSessions={channelSessions} />
    </div>
  );
}
