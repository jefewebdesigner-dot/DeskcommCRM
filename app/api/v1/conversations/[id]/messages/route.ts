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
    // A autorização mora na CONVERSA, não na tabela de mensagens.
    //
    // No Neon Data API, messages_select depende de uma subconsulta em
    // conversations. Essa composição de RLS é mais frágil que a própria regra
    // de visibilidade da conversa e foi a causa de históricos que retornavam
    // 500 mesmo com a conversa visível no Inbox. Fazemos uma única prova com a
    // identidade do usuário e, só depois dela, usamos a identidade técnica para
    // ler o histórico — sempre preso a organization_id + conversation_id pelo
    // listMessagesHandler. O cliente técnico nunca decide autorização.
    const { data: visivel, error: visibilityError } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("organization_id", activeOrg.orgId)
      .maybeSingle();

    if (visibilityError) {
      logger.error("[inbox.messages] não foi possível provar visibilidade da conversa", {
        request_id: requestId,
        organization_id: activeOrg.orgId,
        conversation_id: conversationId,
        visibility_error: visibilityError.message,
      });
      return fail(
        "internal_error",
        t("Não foi possível carregar as mensagens agora."),
        500,
        { requestId },
      );
    }

    if (!visivel) {
      return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
    }

    const resultado = await listMessagesHandler(
      createAdminClient(),
      handlerCtx,
      conversationId,
      qsParsed.data,
    );

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
