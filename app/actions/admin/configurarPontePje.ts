"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { tokenPjeGlobal } from "@/lib/pje/config";
import {
  CHAVE_ADMIN_LEGADO_EMAIL,
  CHAVE_ADMIN_LEGADO_SENHA,
  propagarTokenPjeParaLegado,
  removerCredenciaisPontePje,
  salvarCredenciaisPontePje,
  verificarPontePje,
} from "@/lib/pje/legacy-admin";

const entrada = z.object({
  email: z.string().trim().email().max(320),
  senha: z.string().min(6).max(500),
});

export type ResultadoConfiguracaoPonte =
  | { ok: true; tokenAtualSincronizado: boolean }
  | { ok: false; erro: string };

function mensagemPonte(motivo: string): string {
  if (motivo === "credenciais_invalidas") {
    return "O admin antigo recusou o e-mail ou a senha.";
  }
  if (motivo === "sessao_ausente") {
    return "O admin antigo entrou, mas não criou a sessão esperada.";
  }
  if (motivo === "payload_recusado") {
    return "O admin antigo recusou o formato de atualização do token.";
  }
  return "Não consegui alcançar o admin antigo agora. Tente novamente em instantes.";
}

export async function configurarPontePje(
  email: string,
  senha: string,
): Promise<ResultadoConfiguracaoPonte> {
  const { user } = await requirePlatformAdmin();
  const parsed = entrada.safeParse({ email, senha });
  if (!parsed.success) {
    return { ok: false, erro: "Confira o e-mail e a senha do admin antigo." };
  }

  // Prova antes de persistir: credencial errada nunca vira configuração ativa.
  const teste = await verificarPontePje({
    email: parsed.data.email,
    senha: parsed.data.senha,
  });
  if (!teste.ok) return { ok: false, erro: mensagemPonte(teste.motivo) };

  const salvo = await salvarCredenciaisPontePje(
    parsed.data.email,
    parsed.data.senha,
    user.id,
  );
  if (!salvo.ok) {
    return {
      ok: false,
      erro:
        salvo.motivo === "sem_chave_de_cifra"
          ? "A chave de criptografia da instalação não está disponível; a senha não foi salva."
          : "Não consegui guardar a conexão agora.",
    };
  }

  // Se já existe Token Ouro no cofre novo, conectar a ponte sincroniza na hora.
  const tokenAtual = await tokenPjeGlobal();
  const sync = tokenAtual ? await propagarTokenPjeParaLegado(tokenAtual) : null;

  const cabecalhos = await headers();
  await audit({
    action: "platform.config_changed",
    actorUserId: user.id,
    actingAsPlatformAdmin: true,
    resourceType: "platform_config",
    resourceId: null,
    requestId: cabecalhos.get("x-request-id") ?? undefined,
    ip: cabecalhos.get("x-forwarded-for") ?? undefined,
    userAgent: cabecalhos.get("user-agent") ?? undefined,
    metadata: {
      chaves: [CHAVE_ADMIN_LEGADO_EMAIL, CHAVE_ADMIN_LEGADO_SENHA],
      finalidade: "ponte_pje_legado",
      token_atual_sincronizado: Boolean(sync?.ok),
    },
  });

  revalidatePath("/admin/pje");
  return { ok: true, tokenAtualSincronizado: Boolean(tokenAtual && sync?.ok) };
}

export async function testarPontePje(): Promise<
  { ok: true } | { ok: false; erro: string }
> {
  await requirePlatformAdmin();
  const teste = await verificarPontePje();
  return teste.ok
    ? { ok: true }
    : { ok: false, erro: mensagemPonte(teste.motivo) };
}

export async function desconectarPontePje(): Promise<{ ok: true }> {
  const { user } = await requirePlatformAdmin();
  await removerCredenciaisPontePje();

  await audit({
    action: "platform.config_changed",
    actorUserId: user.id,
    actingAsPlatformAdmin: true,
    resourceType: "platform_config",
    resourceId: null,
    metadata: {
      chaves: [CHAVE_ADMIN_LEGADO_EMAIL, CHAVE_ADMIN_LEGADO_SENHA],
      finalidade: "ponte_pje_legado_removida",
    },
  });

  revalidatePath("/admin/pje");
  return { ok: true };
}
