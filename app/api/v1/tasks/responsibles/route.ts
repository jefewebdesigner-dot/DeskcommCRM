import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { listarResponsaveisDaTarefa } from "@/lib/tarefas/responsaveis";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", {
    requestId,
    resource: "crm_tasks",
  });
  if (!authz.ok) return authz.response;

  try {
    const responsaveis = await listarResponsaveisDaTarefa(authz.org.orgId);
    return ok({ responsaveis }, { requestId });
  } catch {
    return fail(
      "internal_error",
      "Não foi possível carregar os responsáveis das tarefas.",
      500,
      { requestId },
    );
  }
}
