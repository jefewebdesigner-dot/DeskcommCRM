/**
 * Credencial GLOBAL do PJe desta instalação.
 *
 * Um único token alimenta a integração de processos de todos os tenants. Isso
 * é deliberadamente configuração de PLATAFORMA, não de organização: duplicar a
 * credencial por cliente faria o operador atualizar dezenas de cópias do mesmo
 * segredo e criaria divergência silenciosa.
 *
 * O plaintext só existe server-side no instante do uso. A tela chama
 * estadoTokenPje(), que devolve somente presença/origem/last4.
 */
import "server-only";

import {
  estadoParaTela,
  gravarPelaTela,
  valorDaInstalacao,
  type EstadoParaTela,
  type ResultadoDaEscrita,
} from "@/lib/instalacao/config";

export const CHAVE_TOKEN_PJE = "PJE_GLOBAL_TOKEN";

/** Porta que o adaptador de importação deve usar no Passo 2. */
export async function tokenPjeGlobal(): Promise<string | null> {
  return (await valorDaInstalacao("PJE_GLOBAL_TOKEN")).valor;
}

/** Estado seguro para UI: nunca contém o token. */
export async function estadoTokenPje(): Promise<EstadoParaTela> {
  return estadoParaTela(CHAVE_TOKEN_PJE, true);
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
