import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { EXPLICACAO_DA_ORIGEM, resolverChaveDeEmbedding } from "@/lib/ai/embeddings/chave";
import type { EstadoDaChave } from "@/components/ai/ChaveDeConhecimento";
import type { SourceRow } from "@/hooks/ai/useKnowledgeSources";
import { AcervoClient, type AgenteQueUsa } from "./_client";

export const dynamic = "force-dynamic";

/**
 * O ACERVO DA ORGANIZAÇÃO.
 *
 * Esta página resolvia o agente com `.eq("is_default", true)` e mostrava quatro
 * cartões fixos, um por categoria. Como TODO agente criado pela interface nasce
 * `is_default: false`, só o agente semeado no bootstrap alcançava a tela — e
 * material de qualquer outro assistente era invisível aqui e no indexador.
 *
 * Desde a 0181 o acervo é da organização e cada assistente escolhe, na versão
 * publicada dele, o que consulta. Esta tela é a biblioteca; a escolha mora na
 * tela do agente.
 *
 * O estado da CHAVE vem do servidor junto com a lista, e não por fetch depois:
 * ele decide o que a tela pode prometer, e prometer primeiro para desmentir
 * depois é o defeito que esta página tinha.
 */
export default async function AcervoPage() {
  const user = await requireAuth();
  // `t` local em vez do hook: esta página é componente de SERVIDOR, e lá o
  // idioma vem resolvido em `user.idioma` (a cadeia pessoa → organização →
  // padrão vive em `lib/auth/server.ts`).
  const t = (texto: string) => traduzir(texto, user.idioma);
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  const supabase = await createClient();

  const [{ data: sourcesRaw }, { data: agentesRaw }, chave, { data: credenciais }] =
    await Promise.all([
      supabase
        .from("ai_knowledge_sources")
        .select("*")
        .eq("organization_id", activeOrg.orgId)
        .order("created_at", { ascending: false }),
      // Quem consulta o quê. A tela precisa disto para responder "se eu arquivar
      // este material, quem para de saber dele?" — sem essa resposta, arquivar é
      // um tiro no escuro.
      supabase
        .from("ai_agents")
        .select("id, name, published_version_id, ai_agent_versions!inner(id, knowledge_source_ids)")
        .eq("organization_id", activeOrg.orgId)
        .is("archived_at", null),
      resolverChaveDeEmbedding(activeOrg.orgId),
      supabase
        .from("ai_provider_credentials_safe")
        .select("id, label, api_key_last4, validated_at, validation_error, is_active")
        .eq("organization_id", activeOrg.orgId)
        .eq("provider", "openai")
        .order("created_at", { ascending: true }),
    ]);

  const initialSources = (sourcesRaw ?? []) as unknown as SourceRow[];

  const agentes: AgenteQueUsa[] = (
    (agentesRaw ?? []) as unknown as Array<{
      id: string;
      name: string;
      published_version_id: string | null;
      ai_agent_versions: Array<{ id: string; knowledge_source_ids: string[] | null }>;
    }>
  )
    .map((a) => {
      const publicada = a.ai_agent_versions.find((v) => v.id === a.published_version_id);
      return {
        id: a.id,
        nome: a.name,
        materiais: publicada?.knowledge_source_ids ?? [],
      };
    })
    .filter((a) => a.materiais.length > 0);

  const estadoDaChave: EstadoDaChave = {
    pode_indexar: chave !== null,
    origem: chave?.origem ?? null,
    explicacao: chave ? EXPLICACAO_DA_ORIGEM[chave.origem] : null,
    chave_em_uso: chave?.rotulo ?? null,
    avisos: chave?.avisos ?? [],
    credenciais_openai: (credenciais ?? []) as EstadoDaChave["credenciais_openai"],
  };

  return (
    <div className="flex h-full flex-col gap-5 p-4 sm:p-6">
      <header className="relative overflow-hidden rounded-[24px] border border-border/60 bg-gradient-to-br from-card via-card to-muted/35 p-5 shadow-[0_10px_32px_rgba(0,0,0,0.045)] sm:p-6">
        <div
          className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full bg-primary/[0.045] blur-3xl"
          aria-hidden="true"
        />
        <div className="relative">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {t("Biblioteca de conhecimento")}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.045em] sm:text-[2rem]">
            {t("O que o agente sabe")}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-text-muted">
            {t(
              "Centralize documentos, perguntas frequentes e materiais do negócio que seus assistentes consultam antes de responder.",
            )}
          </p>
        </div>
      </header>

      <AcervoClient
        initialSources={initialSources}
        initialChave={estadoDaChave}
        agentes={agentes}
      />
    </div>
  );
}
