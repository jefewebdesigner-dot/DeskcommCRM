import { requireAuth, isMfaEnrolled, resolveActiveOrg, requiresMfa } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { empresaExigeMfa } from "@/lib/auth/politica-mfa";
import { SecurityClient } from "./_client";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

/**
 * SEGURANÇA — e, desde esta rodada, o lugar ONDE a verificação em duas etapas
 * se liga e se desliga.
 *
 * A tela existia e não fazia nem uma coisa nem outra: dizia "Ativado/Não
 * ativado" e, quando não ativado, mandava "Faça login novamente para iniciar o
 * enrolamento" — porque o ÚNICO ponto de cadastro do produto era o bloqueador de
 * tela cheia que aparecia sozinho para todo admin. Com o cadastro virando
 * opcional, essa tela passaria a ser um beco: sem um botão aqui, a verificação
 * ficaria inalcançável para quem quisesse usá-la.
 */
export default async function SecurityPage() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  const enrolled = await isMfaEnrolled();

  let empresaExige = false;
  if (org) {
    const { data } = await createAdminClient()
      .from("organizations")
      .select("settings")
      .eq("id", org.orgId)
      .maybeSingle();
    empresaExige = empresaExigeMfa(data?.settings);
  }

  // A mesma função que o layout usa para decidir o bloqueio — a tela não pode
  // ter uma segunda noção de "é obrigatório", ou ofereceria desligar o que o
  // layout volta a exigir no próximo carregamento.
  const obrigatorio = await requiresMfa(org?.role, user.is_platform_admin, user.id, org?.orgId);
  const idioma = user.idioma;

  return (
    <div className="flex h-full flex-col gap-5 p-4 sm:p-6">
      <header className="relative overflow-hidden rounded-[24px] border border-border/60 bg-gradient-to-br from-card via-card to-muted/35 p-5 shadow-[0_10px_32px_rgba(0,0,0,0.045)] sm:p-6">
        <div
          className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full bg-emerald-500/[0.06] blur-3xl"
          aria-hidden="true"
        />
        <div className="relative">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {traduzir("Proteção da conta", idioma)}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.045em] sm:text-[2rem]">
            {traduzir("Segurança", idioma)}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {traduzir(
              "A verificação em duas etapas da sua conta, os códigos de recuperação e as sessões abertas.",
              idioma,
            )}
          </p>
        </div>
      </header>

      <SecurityClient
        mfaEnrolled={enrolled}
        obrigatorio={obrigatorio}
        podeExigirDaEquipe={org?.role === "admin"}
        empresaExige={empresaExige}
      />
    </div>
  );
}
