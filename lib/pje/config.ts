/**
 * Credencial GLOBAL do PJe desta instalação.
 *
 * Um único token alimenta a integração de processos de todos os tenants. Isso
 * é deliberadamente configuração de PLATAFORMA, não de organização.
 *
 * O plaintext só existe server-side no instante do uso. A tela recebe apenas
 * presença, last4 e metadados operacionais não secretos (como expiração JWT).
 */
import "server-only";

import { Buffer } from "node:buffer";

import {
  estadoParaTela,
  gravarPelaTela,
  valorDaInstalacao,
  type EstadoParaTela,
  type ResultadoDaEscrita,
} from "@/lib/instalacao/config";

export const CHAVE_TOKEN_PJE = "PJE_GLOBAL_TOKEN";

export interface StatusTokenPje {
  readonly configurado: boolean;
  /**
   * Expiração declarada pelo próprio JWT. Não substitui validação criptográfica
   * nem uma chamada à PDPJ; serve para operação perceber um token já vencido.
   */
  readonly expiraEm: string | null;
  readonly expirado: boolean | null;
}

function expiracaoDeclaradaNoJwt(token: string): string | null {
  try {
    const partes = token.split(".");
    if (partes.length < 2 || !partes[1]) return null;
    const payload = JSON.parse(
      Buffer.from(partes[1], "base64url").toString("utf8"),
    ) as { exp?: unknown };
    if (
      typeof payload.exp !== "number" ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= 0
    ) {
      return null;
    }
    return new Date(payload.exp * 1000).toISOString();
  } catch {
    return null;
  }
}

/** Porta única que o adaptador PJe deve usar para obter o token em vigor. */
export async function tokenPjeGlobal(): Promise<string | null> {
  return (await valorDaInstalacao(CHAVE_TOKEN_PJE)).valor;
}

/** Estado seguro para UI: nunca contém o token. */
export async function estadoTokenPje(): Promise<EstadoParaTela> {
  return estadoParaTela(CHAVE_TOKEN_PJE, true);
}

export async function statusTokenPje(): Promise<StatusTokenPje> {
  const token = await tokenPjeGlobal();
  if (!token) {
    return { configurado: false, expiraEm: null, expirado: null };
  }

  const expiraEm = expiracaoDeclaradaNoJwt(token);
  return {
    configurado: true,
    expiraEm,
    expirado: expiraEm ? Date.parse(expiraEm) <= Date.now() : null,
  };
}

export async function salvarTokenPje(
  token: string,
  ator: string,
): Promise<ResultadoDaEscrita> {
  return gravarPelaTela(CHAVE_TOKEN_PJE, token, {
    ehSegredo: true,
    ator,
  });
}
