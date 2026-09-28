import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { tipoOperacionalDoFunil } from "@/lib/pipelines/funis-operacionais";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Funis" };

/**
 * Entrada operacional de Funis.
 *
 * Esta rota nunca renderiza a tela de configuração: ela abre o funil de Vendas
 * ou usa o padrão/primeiro ativo como fallback. O gerenciamento fica em
 * /app/kanban/gerenciar para que clicar em "Funis" na sidebar sempre mude de
 * contexto, inclusive quando o usuário estiver gerenciando os funis.
 */
export default async function KanbanEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ gerenciar?: string }>;
}) {
  const { gerenciar } = await searchParams;
  if (gerenciar === "1") redirect("/app/kanban/gerenciar");

  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();
  const { data } = await supabase
    .from("crm_pipelines")
    .select("id, is_default, is_archived, settings")
    .eq("organization_id", activeOrg.orgId)
    .order("position");

  const funis = (data ?? []).filter((funil) => !funil.is_archived);
  const vendas =
    funis.find((funil) => tipoOperacionalDoFunil(funil.settings) === "sales") ??
    funis.find((funil) => funil.is_default) ??
    funis[0];

  if (vendas) redirect(`/app/pipelines/${vendas.id}`);

  // Organização ainda sem funis: configuração é o único destino útil.
  redirect("/app/kanban/gerenciar");
}
