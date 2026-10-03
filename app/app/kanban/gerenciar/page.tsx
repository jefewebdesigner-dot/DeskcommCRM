import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Kanban } from "@/lib/ui/icons";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { FunisClient, type FunilDaLista, type MetricasDoFunilDaLista } from "../_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Gerenciar funis" };

/**
 * A lista de funis — e o lugar onde eles se gerenciam.
 *
 * ⚠️ O FILTRO DE `organization_id` NÃO É REDUNDANTE COM A RLS, e a falta dele era
 * um bug visível: a policy `crm_pipelines_select` libera TODAS as organizações do
 * usuário (`organization_id in fn_user_org_ids()`) e libera tudo para
 * `fn_is_platform_admin()`. Quem participa de duas organizações via as duas
 * listas misturadas — e como o gatilho `trg_seed_default_pipeline_for_org` semeia
 * um funil "Pedidos" em toda organização nova, a tela mostrava várias linhas
 * idênticas, indistinguíveis, cada uma levando a um quadro diferente. A RLS
 * responde "pode ver?"; a tela precisa responder "quer ver agora?".
 *
 * ⚠️ A LEITURA É ABERTA, A ESCRITA É manager+. Ver a lista e abrir o quadro é
 * trabalho de qualquer papel; criar, renomear, reordenar e arquivar é
 * configuração — e é o que `requireRole("manager")` cobra nas rotas.
 * `podeGerenciar` usa o MESMO critério delas (o papel na organização ativa, sem
 * atalho de platform admin, que as rotas não concedem por padrão): mostrar um
 * botão que o servidor recusaria seria prometer o que não se cumpre.
 */
export default async function GerenciarFunisPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();
  const { data } = await supabase
    .from("crm_pipelines")
    // `is_client_pipeline` entra: sem ela o selo "Clientes" não aparecia ao
    // carregar a página e o botão sempre oferecia "Funil de clientes", mesmo no
    // funil já marcado — só o corpo de um PATCH trazia a coluna.
    //
    // ⚠️ `is_archived` DEIXOU DE SER FILTRO E VIROU COLUNA (#979). Antes a
    // consulta cortava os arquivados no banco, e o resultado era um funil
    // invisível e indestrutível: quem arquivou não tinha como ver, tirar do
    // arquivo nem excluir o que arquivou. A separação passou para a partição
    // abaixo — a lista de trabalho continua só com os vivos.
    .select(
      "id, name, slug, description, position, is_default, is_client_pipeline, is_archived, settings",
    )
    .eq("organization_id", activeOrg.orgId)
    .order("position");

  const todos = (data ?? []) as Array<FunilDaLista & { is_archived: boolean }>;
  const funis = todos.filter((f) => !f.is_archived);

  const { data: negociosAbertos } = await supabase
    .from("crm_leads")
    .select("pipeline_id, value_cents, currency, owner_user_id, owner_agent_id")
    .eq("organization_id", activeOrg.orgId)
    .eq("status", "open");

  const metricasPorFunil: Record<string, MetricasDoFunilDaLista> = Object.fromEntries(
    todos.map((funil) => [funil.id, { abertos: 0, semResponsavel: 0, valores: [] }]),
  );
  const valoresPorFunil = new Map<string, Map<string, number>>();
  for (const negocio of negociosAbertos ?? []) {
    const metricas = metricasPorFunil[negocio.pipeline_id];
    if (!metricas) continue;
    metricas.abertos += 1;
    if (!negocio.owner_user_id && !negocio.owner_agent_id) metricas.semResponsavel += 1;
    if (negocio.value_cents == null) continue;
    const moeda = negocio.currency ?? "BRL";
    const porMoeda = valoresPorFunil.get(negocio.pipeline_id) ?? new Map<string, number>();
    porMoeda.set(moeda, (porMoeda.get(moeda) ?? 0) + negocio.value_cents);
    valoresPorFunil.set(negocio.pipeline_id, porMoeda);
  }
  for (const [pipelineId, porMoeda] of valoresPorFunil) {
    metricasPorFunil[pipelineId]!.valores = [...porMoeda.entries()]
      .map(([moeda, centavos]) => ({ moeda, centavos }))
      .sort((a, b) => a.moeda.localeCompare(b.moeda));
  }
  const podeGerenciar = ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;
  // O arquivo só vai para quem pode mexer nele: tirar do arquivo e excluir são
  // `requireRole("manager")` nas rotas, e mostrar a gaveta a quem receberia 403
  // seria prometer o que não se cumpre — mesmo critério de `podeGerenciar`.
  const arquivados = podeGerenciar ? todos.filter((f) => f.is_archived) : [];
  // Importar planilha é ESCRITA DE OPERAÇÃO, não configuração: quem atende
  // sobe a lista que recebeu. Espelha o `requireRole("agent")` da rota.
  const podeImportar = ROLE_RANK[activeOrg.role] >= ROLE_RANK.agent;
  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);

  return (
    <div className="flex h-full flex-col gap-5 p-4 sm:p-6">
      <header className="relative overflow-hidden rounded-[24px] border border-border/60 bg-gradient-to-br from-card via-card to-muted/35 p-5 shadow-[0_10px_32px_rgba(0,0,0,0.045)] sm:p-6">
        <div
          className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full bg-primary/[0.045] blur-3xl"
          aria-hidden="true"
        />
        <div className="relative flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/70 shadow-sm">
            <Kanban size={21} className="text-muted-foreground" weight="duotone" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              {t("Estrutura comercial")}
            </p>
            {/* Era "Pipelines" — nome de quem construiu o sistema, não de quem
                vende. O comentário anterior aqui listava o preço de trocá-lo
                (`rbac-roles.spec.ts` e `invite-lifecycle.spec.ts`) e dizia que
                uniformizar era decisão do dono do produto. Ela foi tomada, e o preço
                era maior do que o comentário contava: são QUATRO assertions em TRÊS
                specs, e `pipelines-gestao.spec.ts` — a spec da própria feature que
                gerou o comentário — é uma delas. Todas atualizadas junto. */}
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.045em] sm:text-[2rem]">
              {t("Gerenciar funis")}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {t(
                "Organize os funis, acompanhe a carga de cada um e gerencie o que está ativo ou arquivado.",
              )}
            </p>
          </div>
        </div>
      </header>

      <FunisClient
        funis={funis}
        arquivados={arquivados}
        podeGerenciar={podeGerenciar}
        podeImportar={podeImportar}
        metricasPorFunil={metricasPorFunil}
      />
    </div>
  );
}
