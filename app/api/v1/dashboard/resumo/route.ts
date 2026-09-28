import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "dashboard" });
  if (!authz.ok) return authz.response;

  const db = await createClient();
  const org = authz.org.orgId;
  const agora = new Date();
  const inicioHoje = new Date(agora);
  inicioHoje.setHours(0, 0, 0, 0);
  const em30Dias = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000);
  const ha30Dias = new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);

  const count = (table: string) =>
    db.from(table).select("id", { count: "exact", head: true }).eq("organization_id", org);

  const [contatos, negocios, fila, tarefas, atrasadas, agenda, leads30d] = await Promise.all([
    count("contacts"),
    count("crm_leads").eq("status", "open"),
    count("conversations").eq("comando_da_conversa", "humano").not("status", "in", "(closed,archived)"),
    count("crm_tasks").in("status", ["pending", "in_progress"]),
    count("crm_tasks")
      .in("status", ["pending", "in_progress"])
      .not("due_date", "is", null)
      .lt("due_date", agora.toISOString()),
    count("calendar_appointments")
      .in("status", ["pending", "confirmed"])
      .gte("starts_at", inicioHoje.toISOString())
      .lte("starts_at", em30Dias.toISOString()),
    db.from("crm_leads")
      .select("id,status,value_cents,currency,source_metadata,created_at,closed_at")
      .eq("organization_id", org)
      .or(`created_at.gte.${ha30Dias.toISOString()},closed_at.gte.${ha30Dias.toISOString()}`),
  ]);

  const erro = [contatos, negocios, fila, tarefas, atrasadas, agenda, leads30d].find((r) => r.error)?.error;
  if (erro) return fail("internal_error", "Não foi possível carregar o resumo operacional.", 500, { requestId });

  const atribuidosMeta = (leads30d.data ?? []).filter((lead) => {
    const meta = lead.source_metadata && typeof lead.source_metadata === "object" && !Array.isArray(lead.source_metadata)
      ? lead.source_metadata as Record<string, unknown>
      : {};
    return meta.ad_platform === "meta_ads" && typeof meta.ad_source_id === "string" && meta.ad_source_id.trim() !== "";
  });
  const oportunidadesMeta30d = atribuidosMeta.filter((lead) => new Date(lead.created_at) >= ha30Dias).length;
  const vendasMeta30d = atribuidosMeta.filter(
    (lead) => lead.status === "won" && lead.closed_at && new Date(lead.closed_at) >= ha30Dias,
  );
  const receitaMeta30dCents = vendasMeta30d.reduce(
    (total, lead) => total + (lead.currency === "BRL" || !lead.currency ? Math.max(0, lead.value_cents ?? 0) : 0),
    0,
  );

  return ok(
    {
      contatos: contatos.count ?? 0,
      negocios_abertos: negocios.count ?? 0,
      aguardando_atendimento: fila.count ?? 0,
      tarefas_abertas: tarefas.count ?? 0,
      tarefas_atrasadas: atrasadas.count ?? 0,
      compromissos_30d: agenda.count ?? 0,
      meta_atribuicao_30d: {
        oportunidades: oportunidadesMeta30d,
        vendas: vendasMeta30d.length,
        receita_cents: receitaMeta30dCents,
        moeda: "BRL",
      },
      atualizado_em: agora.toISOString(),
    },
    { requestId },
  );
}
