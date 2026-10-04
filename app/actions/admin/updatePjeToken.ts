"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import {
  CHAVE_TOKEN_PJE,
  estadoTokenPje,
  salvarTokenPje,
  statusTokenPje,
} from "@/lib/pje/config";
import { propagarTokenPjeParaLegado } from "@/lib/pje/legacy-admin";

const entrada = z.object({
  // Tokens PJe podem ser JWTs longos. Não imponha formato que o sistema antigo
  // nunca prometeu; só recuse vazio/absurdamente grande.
  token: z.string().trim().min(10).max(50_000),
});

export type AtualizarTokenPjeResult =
  | {
      ok: true;
      last4: string | null;
      expiraEm: string | null;
      expirado: boolean | null;
      sincronizacaoLegado: "ok" | "nao_configurada" | "falhou";
    }
  | { ok: false; erro: string };

export async function atualizarTokenPje(
  bruto: string,
): Promise<AtualizarTokenPjeResult> {
  const { user } = await requirePlatformAdmin();
  const parsed = entrada.safeParse({ token: bruto });
  if (!parsed.success) {
    return { ok: false, erro: "Cole um token PJe válido antes de salvar." };
  }

  const salvo = await salvarTokenPje(parsed.data.token, user.id);
  if (!salvo.ok) {
    if (salvo.motivo === "sem_chave_de_cifra") {
      return {
        ok: false,
        erro:
          "A chave de criptografia da instalação não está disponível. O token não foi salvo em claro.",
      };
    }
    return { ok: false, erro: "Não foi possível salvar o token PJe agora." };
  }

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
      chave: CHAVE_TOKEN_PJE,
      natureza: "segredo",
      last4: parsed.data.token.slice(-4),
      alcance: "instalacao",
    },
  });

  // O cofre novo é a fonte da migração. Enquanto o PeríciaIA antigo ainda
  // atende os clientes, propagamos o mesmo Token Ouro pela sessão administrativa
  // legada. Falhar aqui NÃO desfaz o cofre novo: a UI mostra que a ponte precisa
  // de atenção, sem perder a credencial que acabou de ser colada.
  const legado = await propagarTokenPjeParaLegado(parsed.data.token);

  revalidatePath("/admin/pje");
  const [estado, status] = await Promise.all([
    estadoTokenPje(),
    statusTokenPje(),
  ]);
  return {
    ok: true,
    last4: estado.last4,
    expiraEm: status.expiraEm,
    expirado: status.expirado,
    sincronizacaoLegado: legado.ok
      ? "ok"
      : legado.motivo === "nao_configurada"
        ? "nao_configurada"
        : "falhou",
  };
}
