/**
 * Ponte temporária entre o novo CRM e o admin legado do PeríciaIA.
 *
 * Objetivo operacional: quem administra a plataforma atualiza o Token Ouro no
 * CRM e o sistema legado continua consumindo o mesmo token até o backend antigo
 * ser migrado. A ponte autentica no /api/admin/master-login, usa somente o
 * cookie HttpOnly recebido em memória e chama /api/admin/pje-token.
 *
 * Nenhuma credencial, cookie ou Token Ouro é logado ou retornado ao navegador.
 */
import "server-only";

import {
  estadoParaTela,
  gravarPelaTela,
  valorDaInstalacao,
  voltarAoAmbiente,
  type ResultadoDaEscrita,
} from "@/lib/instalacao/config";

export const CHAVE_ADMIN_LEGADO_EMAIL = "PERICIAIA_LEGACY_ADMIN_EMAIL";
export const CHAVE_ADMIN_LEGADO_SENHA = "PERICIAIA_LEGACY_ADMIN_PASSWORD";

export type EstadoPontePje = {
  configurada: boolean;
  email: string | null;
  senhaConfigurada: boolean;
};

export type ResultadoPonte =
  | { ok: true }
  | {
      ok: false;
      motivo:
        | "nao_configurada"
        | "credenciais_invalidas"
        | "sessao_ausente"
        | "legado_indisponivel"
        | "payload_recusado";
    };

type FalhaPonte = Extract<ResultadoPonte, { ok: false }>;
type SessaoLegada = { ok: true; cookie: string } | FalhaPonte;

function origemLegada(): string {
  const bruto =
    process.env.PERICIAIA_BILLING_EXPORT_BASE_URL?.trim() ||
    "https://www.periciaia.com.br/api/admin/billing-export";
  try {
    return new URL(bruto).origin;
  } catch {
    return "https://www.periciaia.com.br";
  }
}

async function credenciaisLegadas(): Promise<{ email: string; senha: string } | null> {
  const [email, senha] = await Promise.all([
    valorDaInstalacao(CHAVE_ADMIN_LEGADO_EMAIL),
    valorDaInstalacao(CHAVE_ADMIN_LEGADO_SENHA),
  ]);
  const e = email.valor?.trim() ?? "";
  const s = senha.valor ?? "";
  return e && s ? { email: e, senha: s } : null;
}

export async function estadoPontePje(): Promise<EstadoPontePje> {
  const [email, senha] = await Promise.all([
    estadoParaTela(CHAVE_ADMIN_LEGADO_EMAIL, false),
    estadoParaTela(CHAVE_ADMIN_LEGADO_SENHA, true),
  ]);
  return {
    configurada: email.configurado && senha.configurado,
    email: email.valorVisivel?.trim() || null,
    senhaConfigurada: senha.configurado,
  };
}

export async function salvarCredenciaisPontePje(
  email: string,
  senha: string,
  ator: string,
): Promise<ResultadoDaEscrita> {
  const gravouEmail = await gravarPelaTela(
    CHAVE_ADMIN_LEGADO_EMAIL,
    email.trim(),
    { ehSegredo: false, ator },
  );
  if (!gravouEmail.ok) return gravouEmail;

  const gravouSenha = await gravarPelaTela(
    CHAVE_ADMIN_LEGADO_SENHA,
    senha,
    { ehSegredo: true, ator },
  );
  if (!gravouSenha.ok) {
    await voltarAoAmbiente(CHAVE_ADMIN_LEGADO_EMAIL);
    return gravouSenha;
  }
  return { ok: true };
}

export async function removerCredenciaisPontePje(): Promise<void> {
  await Promise.all([
    voltarAoAmbiente(CHAVE_ADMIN_LEGADO_EMAIL),
    voltarAoAmbiente(CHAVE_ADMIN_LEGADO_SENHA),
  ]);
}

function cookieDe(resposta: Response): string | null {
  const headers = resposta.headers as Headers & { getSetCookie?: () => string[] };
  const linhas =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [resposta.headers.get("set-cookie") ?? ""].filter(Boolean);

  const pares = linhas
    .map((linha) => linha.split(";", 1)[0]?.trim())
    .filter((valor): valor is string => Boolean(valor));

  return pares.length ? pares.join("; ") : null;
}

async function criarSessaoLegada(
  email: string,
  senha: string,
): Promise<SessaoLegada> {
  const origem = origemLegada();
  try {
    const resposta = await fetch(`${origem}/api/admin/master-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: origem,
        Referer: `${origem}/admin/login`,
      },
      body: JSON.stringify({ email, password: senha }),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });

    if (resposta.status === 401 || resposta.status === 403) {
      await resposta.body?.cancel();
      return { ok: false, motivo: "credenciais_invalidas" };
    }
    if (!resposta.ok) {
      await resposta.body?.cancel();
      return { ok: false, motivo: "legado_indisponivel" };
    }

    const cookie = cookieDe(resposta);
    await resposta.body?.cancel();
    if (!cookie) return { ok: false, motivo: "sessao_ausente" };
    return { ok: true, cookie };
  } catch {
    return { ok: false, motivo: "legado_indisponivel" };
  }
}

async function comSessaoLegada(
  executar: (entrada: { origem: string; cookie: string }) => Promise<ResultadoPonte>,
  credenciais?: { email: string; senha: string },
): Promise<ResultadoPonte> {
  const atuais = credenciais ?? (await credenciaisLegadas());
  if (!atuais) return { ok: false, motivo: "nao_configurada" };

  const sessao = await criarSessaoLegada(atuais.email, atuais.senha);
  if (!sessao.ok) return sessao;

  return executar({ origem: origemLegada(), cookie: sessao.cookie });
}

/**
 * Prova a ponte sem devolver o Token Ouro atual.
 * O body do GET é descartado porque pode conter o segredo atual.
 */
export async function verificarPontePje(
  credenciais?: { email: string; senha: string },
): Promise<ResultadoPonte> {
  return comSessaoLegada(async ({ origem, cookie }) => {
    try {
      const resposta = await fetch(`${origem}/api/admin/pje-token`, {
        headers: {
          Cookie: cookie,
          Accept: "application/json",
          Origin: origem,
          Referer: `${origem}/admin/token`,
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      await resposta.body?.cancel();

      if (resposta.status === 401 || resposta.status === 403) {
        return { ok: false, motivo: "credenciais_invalidas" };
      }
      return resposta.ok
        ? { ok: true }
        : { ok: false, motivo: "legado_indisponivel" };
    } catch {
      return { ok: false, motivo: "legado_indisponivel" };
    }
  }, credenciais);
}

/**
 * Atualiza o Token Ouro que o PeríciaIA legado já usa hoje.
 *
 * O endpoint GET/POST foi confirmado no sistema antigo. O corpo mantém o
 * contrato natural da tela antiga ({ token }). Se o legado recusar o payload,
 * falhamos explicitamente em vez de tentar formatos inventados.
 */
export async function propagarTokenPjeParaLegado(
  token: string,
): Promise<ResultadoPonte> {
  return comSessaoLegada(async ({ origem, cookie }) => {
    try {
      const resposta = await fetch(`${origem}/api/admin/pje-token`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          Accept: "application/json",
          Origin: origem,
          Referer: `${origem}/admin/token`,
        },
        body: JSON.stringify({ token }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      await resposta.body?.cancel();

      if (resposta.status === 401 || resposta.status === 403) {
        return { ok: false, motivo: "credenciais_invalidas" };
      }
      if (resposta.status === 400 || resposta.status === 422) {
        return { ok: false, motivo: "payload_recusado" };
      }
      return resposta.ok
        ? { ok: true }
        : { ok: false, motivo: "legado_indisponivel" };
    } catch {
      return { ok: false, motivo: "legado_indisponivel" };
    }
  });
}
