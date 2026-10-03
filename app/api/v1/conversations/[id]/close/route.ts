import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { patchConversationHandler } from "@/app/api/v1/conversations/_handler";
import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/v1/conversations/[id]/close — compatibilidade para clientes antigos.
 *
 * O fechamento usa a MESMA fronteira canônica do PATCH /conversations/[id].
 * Isso é importante no Neon Data API: a RPC de status é comando, e o handler
 * relê a conversa depois dela antes de auditar/devolver. Não assumimos que o
 * payload bruto de uma RPC que retorna composite tem formato de Conversation.
 */
export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  let body: unknown = {};
  const text = await req.text();
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return fail("validation_failed", "Corpo inválido.", 422, { requestId });
  }

  const parsed = z
    .object({ expected_revision: z.number().int().positive().optional() })
    .safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "Revisão inválida.", 422, { requestId });
  }

  const { id } = await ctx.params;
  const supabase = await createClient();

  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;

  try {
    const conv = await patchConversationHandler(
      supabase,
      {
        organization_id: authz.org.orgId,
        actor: { type: "user", id: authz.user.id },
        requestId,
        idioma: authz.user.idioma,
      },
      id,
      {
        status: "closed",
        expected_revision: parsed.data.expected_revision,
      },
    );
    return ok(conv, { requestId });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { requestId });
    }
    throw err;
  }
}
