/**
 * Análise → Meta Ads. O que a mídia paga está entregando, ao lado do resto da
 * análise, em vez de numa aba separada do Gerenciador de Anúncios.
 *
 * ─── Por que `manager`, e não `viewer` como Desempenho ──────────────────────
 *
 * A vizinha imediata no menu (`/app/metrics`) é aberta a todo mundo porque
 * mostra o funil e a performance de quem atende — e um `agent` vê as PRÓPRIAS
 * pela RLS. Aqui não há recorte por pessoa: orçamento, custo por lead e
 * criativo são da empresa inteira. É o mesmo grau de Evolução da IA e Audit
 * Log, os outros dois vizinhos do grupo, e os dois são `manager`.
 *
 * ─── Por que o token NÃO passa por aqui ─────────────────────────────────────
 *
 * Esta página pergunta apenas SE existe conexão (`existeConexaoDeLeitura`), que
 * não decifra nada. A única forma de garantir que um segredo não chega ao
 * browser é ele não entrar no componente que renderiza HTML — e a tentação de
 * "já que estou lendo a linha, leio o token junto" é exatamente como ele
 * vazaria para um prop de client component.
 */
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { existeConexaoDeLeitura } from "@/lib/plataformas-de-anuncio/credenciais-de-leitura";
import { createAdminClient } from "@/lib/supabase/admin";

import { MetaAdsClient } from "./_components/MetaAdsClient";

export const metadata = { title: "Meta Ads" };
export const dynamic = "force-dynamic";

export default async function MetaAdsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  const admin = createAdminClient();
  const conexao = await existeConexaoDeLeitura(admin, activeOrg.orgId, "meta_ads");

  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);
  // Quem NÃO pode conectar não deve ler "vá em Configurações" — a tela lá é
  // `admin`, e mandar um manager para uma porta que devolve 403 é pior que
  // dizer a verdade: ele precisa pedir para alguém.
  const podeConectar =
    (user.is_platform_admin && !user.support) || ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin;

  return (
    /*
      Superfície clara — mesmo escopo de Desempenho, a vizinha no menu. `-m-6`
      cancela o respiro do `<main>` do AppShell para o Paper alcançar a borda, e
      o `p-6` o repõe.
    */
    <div
      data-superficie="clara"
      className="-m-6 flex min-h-[calc(100%+3rem)] flex-col gap-5 bg-bg p-4 text-text sm:p-6"
    >
      <header className="relative overflow-hidden rounded-[24px] border border-border/60 bg-gradient-to-br from-card via-card to-muted/35 p-5 shadow-[0_10px_32px_rgba(0,0,0,0.045)] sm:p-6">
        <div
          className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full bg-blue-500/[0.06] blur-3xl"
          aria-hidden="true"
        />
        <div className="relative">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {t("Aquisição")}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.045em] sm:text-[2rem]">
            {t("Meta Ads")}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {t(
              "O desempenho das campanhas que estão trazendo gente para cá. Os números vêm da plataforma no momento em que você clica em Atualizar — nada fica guardado aqui.",
            )}
          </p>
        </div>
      </header>

      {conexao.conectada ? (
        <MetaAdsClient contaPadrao={conexao.contaPadrao} idioma={idioma} />
      ) : (
        <div className="rounded-[24px] border border-border/60 bg-card p-6 text-sm shadow-sm">
          <p className="font-medium">{t("Nenhuma conta de anúncios conectada.")}</p>
          <p className="mt-1 text-muted-foreground">
            {podeConectar
              ? t(
                  "Conecte um token de acesso com permissão de leitura de anúncios para ver as campanhas aqui.",
                )
              : t(
                  "Peça a quem administra a organização para conectar a conta de anúncios em Configurações.",
                )}
          </p>
          {podeConectar && (
            <a
              className="mt-4 inline-block rounded-xl border border-border/60 px-4 py-2 font-medium underline-offset-2 transition-colors hover:bg-muted"
              href="/app/settings/meta-ads"
            >
              {t("Conectar conta de anúncios")}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
