/**
 * Limites do plano do Gravity CRM (venda assistida: o dono cria a organização pelo painel e define o plano).
 *
 * - `settings.plan` define o padrão: standard (R$ 99,90) = 2 usuários e 1 número de WhatsApp;
 *   pro = 10 e 3; enterprise = sem limite.
 * - `settings.limites` sobrescreve por organização (ex.: cliente que pagou usuário extra):
 *   `{ "usuarios": 5 }` ou `{ "whatsapp": null }` (null = sem limite).
 * - Organização SEM plano (as anteriores ao SaaS, como a PeríciaIA) não tem limite: nada muda para elas.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type RecursoLimitado = "usuarios" | "whatsapp";
export type Limites = Record<RecursoLimitado, number | null>;

export const LIMITES_POR_PLANO: Record<string, Limites> = {
  standard: { usuarios: 2, whatsapp: 1 },
  pro: { usuarios: 10, whatsapp: 3 },
  enterprise: { usuarios: null, whatsapp: null },
};

const SEM_LIMITE: Limites = { usuarios: null, whatsapp: null };

function numeroOuNulo(v: unknown, padrao: number | null): number | null {
  if (v === null) return null;
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  return padrao;
}

export function limitesDaOrganizacao(settings: unknown): Limites {
  const s = settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
  const plano = typeof s.plan === "string" ? s.plan : "";
  const base = LIMITES_POR_PLANO[plano] ?? SEM_LIMITE;
  const o = s.limites && typeof s.limites === "object" ? (s.limites as Record<string, unknown>) : {};
  return {
    usuarios: "usuarios" in o ? numeroOuNulo(o.usuarios, base.usuarios) : base.usuarios,
    whatsapp: "whatsapp" in o ? numeroOuNulo(o.whatsapp, base.whatsapp) : base.whatsapp,
  };
}

export type ResultadoDoLimite =
  | { ok: true }
  | { ok: false; recurso: RecursoLimitado; limite: number; usados: number; mensagem: string };

const MENSAGEM: Record<RecursoLimitado, (limite: number) => string> = {
  usuarios: (n) =>
    `Seu plano permite ${n} ${n === 1 ? "usuário" : "usuários"} (contando convites pendentes). Para adicionar mais, fale com o suporte para incluir usuários no plano.`,
  whatsapp: (n) =>
    `Seu plano permite ${n} ${n === 1 ? "número" : "números"} de WhatsApp. Para conectar outro, arquive um número ou fale com o suporte para ampliar o plano.`,
};

/** Decide sem E/S — o chamador conta o uso. `novos` = quantos esta ação acrescenta. */
export function decidirLimite(limites: Limites, recurso: RecursoLimitado, usados: number, novos = 1): ResultadoDoLimite {
  const limite = limites[recurso];
  if (limite === null || usados + novos <= limite) return { ok: true };
  return { ok: false, recurso, limite, usados, mensagem: MENSAGEM[recurso](limite) };
}

/**
 * Lê o plano e conta o uso. Falha de leitura NUNCA bloqueia (aberto na ação): limite é cobrança,
 * não segurança — um erro de banco não pode impedir o cliente de trabalhar.
 * `ignorarEmails`: quem já tem convite pendente não ocupa vaga nova num reenvio.
 */
export async function verificarLimite(
  admin: SupabaseClient,
  organizationId: string,
  recurso: RecursoLimitado,
  opcoes: { novos?: number; ignorarEmails?: string[] } = {},
): Promise<ResultadoDoLimite> {
  try {
    const { data: org } = await admin.from("organizations").select("settings").eq("id", organizationId).maybeSingle();
    const limites = limitesDaOrganizacao(org?.settings);
    if (limites[recurso] === null) return { ok: true };

    let usados = 0;
    if (recurso === "usuarios") {
      const { count: membros } = await admin
        .from("user_organizations")
        .select("user_id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .is("revoked_at", null);
      const { data: pendentes } = await admin
        .from("team_invites")
        .select("email")
        .eq("organization_id", organizationId)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString());
      const ignorar = new Set((opcoes.ignorarEmails ?? []).map((e) => e.trim().toLowerCase()));
      usados = (membros ?? 0) + (pendentes ?? []).filter((p) => !ignorar.has(String(p.email).toLowerCase())).length;
    } else {
      const { count } = await admin
        .from("channel_sessions")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .is("archived_at", null);
      usados = count ?? 0;
    }
    return decidirLimite(limites, recurso, usados, opcoes.novos ?? 1);
  } catch {
    return { ok: true };
  }
}
