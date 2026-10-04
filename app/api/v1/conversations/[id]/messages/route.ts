/**
 * GET /api/v1/conversations/[id]/messages — histórico de mensagens (handler
 * em /app/api/v1/messages/_handler.ts → listMessagesHandler).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { logger } from "@/lib/logger";
import { listMessagesQuerySchema } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { listMessagesHandler } from "@/app/api/v1/messages/_handler";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: conversationId } = await ctx.params;
  const supabase = await createClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }

  const authUser = await loadAuthUser();
  const t = (texto: string) => traduzir(texto, authUser?.idioma ?? "pt-BR");
  const activeOrg = authUser ? await resolveActiveOrg(authUser) : null;
  if (!activeOrg) {
    return fail("no_active_org", t("No active organization."), 403, { requestId });
  }

  const url = new URL(req.url);
  const qsParsed = listMessagesQuerySchema.safeParse({
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!qsParsed.success) {
    return fail("validation_failed", t("Query inválida."), 422, {
      details: qsParsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }

  const handlerCtx = {
    organization_id: activeOrg.orgId,
    actor: { type: "user" as const, id: user.id },
    requestId,
    idioma: authUser?.idioma,
  };

  try {
    let resultado;
    try {
      resultado = await listMessagesHandler(
        supabase,
        handlerCtx,
        conversationId,
        qsParsed.data,
      );
    } catch (err) {
      // Neon Data API aplica a RLS do usuário. Em algumas instalações a leitura
      // aninhada de `messages -> conversations` pode falhar mesmo quando a
      // conversa é visível. NÃO caímos direto no cliente técnico: primeiro a
      // própria RLS do usuário precisa provar que ESTA conversa está visível e
      // pertence à organização ativa. Só então repetimos a mesma leitura com a
      // identidade técnica, ainda filtrada por organization_id + conversation_id
      // dentro de listMessagesHandler. Assim o fallback não amplia acesso.
      if (!(err instanceof ApiError) || err.code !== "internal_error") throw err;

      const { data: visivel, error: visibilityError } = await supabase
        .from("conversations")
        .select("id")
        .eq("id", conversationId)
        .eq("organization_id", activeOrg.orgId)
        .maybeSingle();

      if (visibilityError || !visivel) {
        logger.error("[inbox.messages] leitura falhou e fallback não foi autorizado", {
          request_id: requestId,
          organization_id: activeOrg.orgId,
          conversation_id: conversationId,
          code: err.code,
          data_api_error: err.message,
          visibility_error: visibilityError?.message ?? null,
        });
        if (!visivel && !visibilityError) {
          return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
        }
        throw err;
      }

      logger.warn("[inbox.messages] leitura RLS falhou; usando fallback técnico autorizado", {
        request_id: requestId,
        organization_id: activeOrg.orgId,
        conversation_id: conversationId,
        data_api_error: err.message,
      });

      resultado = await listMessagesHandler(
        createAdminClient(),
        handlerCtx,
        conversationId,
        qsParsed.data,
      );
    }

    return ok(resultado.messages, {
      requestId,
      meta: { cursor: resultado.cursor, has_more: resultado.has_more },
    });
  } catch (err) {
    if (err instanceof ApiError) {
      logger.error("[inbox.messages] falha ao listar histórico", {
        request_id: requestId,
        organization_id: activeOrg.orgId,
        conversation_id: conversationId,
        code: err.code,
        status: err.status,
        error: err.message,
      });
      return fail(err.code, err.message, err.status, { requestId });
    }
    logger.error("[inbox.messages] exceção não tratada", {
      request_id: requestId,
      organization_id: activeOrg.orgId,
      conversation_id: conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
