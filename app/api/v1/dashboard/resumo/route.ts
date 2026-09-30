import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { isServiceRoleConfigured } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "dashboard" });
  if (!authz.ok) return authz.response;

  const db = await createClient();
  const org = authz.org.orgId;
  // O resumo operacional precisa enxergar configuração da organização inteira
  // (equipe/canais/agenda), não só o que a RLS do papel atual deixa listar.
  // Com service role, o escopo continua explícito pelo organization_id abaixo.
  const configDb = isServiceRoleConfigured() ? createAdminClient() : db;
  const agora = new Date();
  const inicioHoje = new Date(agora);
  inicioHoje.setHours(0, 0, 0, 0);
  const em30Dias = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000);
  const ha30Dias = new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);

  const count = (table: string) =>
    db.from(table).select("id", { count: "exact", head: true }).eq("organization_id", org);

  const [
    contatos,
    negocios,
    fila,
    tarefas,
    atrasadas,
    agenda,
    leads30d,
    responsaveis,
    canais,
    conexoesAgenda,
    credenciaisIa,
    conexaoMeta,
  ] = await Promise.all([
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
    configDb
      .from("user_organizations")
      .select("user_id", { count: "exact", head: true })
      .eq("organization_id", org)
      .is("revoked_at", null)
      .in("role", ["agent", "manager", "admin"]),
    configDb
      .from("channel_sessions")
      .select("status")
      .eq("organization_id", org)
      .is("archived_at", null),
    configDb
      .from("calendar_connections")
      .select("status")
      .eq("organization_id", org)
      .eq("provider", "google_calendar")
      .neq("status", "disconnected"),
    configDb
      .from("ai_provider_credentials")
      .select("is_active,validated_at")
      .eq("organization_id", org),
    configDb
      .from("ad_insights_connections")
      .select("id")
      .eq("organization_id", org)
      .eq("platform", "meta_ads")
      .maybeSingle(),
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

  const canaisRows = canais.error ? null : (canais.data ?? []);
  const agendaRows = conexoesAgenda.error ? null : (conexoesAgenda.data ?? []);
  const iaRows = credenciaisIa.error ? null : (credenciaisIa.data ?? []);
  const metaRow = conexaoMeta.error ? null : conexaoMeta.data;

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
      prontidao: {
        responsaveis_ativos: responsaveis.error ? null : (responsaveis.count ?? 0),
        whatsapp: {
          total: canaisRows === null ? null : canaisRows.length,
          conectados: canaisRows === null ? null : canaisRows.filter((c) => c.status === "WORKING").length,
        },
        agenda_google: {
          total: agendaRows === null ? null : agendaRows.length,
          saudaveis: agendaRows === null ? null : agendaRows.filter((c) => c.status === "healthy").length,
        },
        inteligencia_artificial: {
          credenciais_ativas: iaRows === null ? null : iaRows.filter((c) => c.is_active).length,
          validadas: iaRows === null ? null : iaRows.filter((c) => c.is_active && c.validated_at !== null).length,
        },
        meta_ads: {
          conectada: conexaoMeta.error ? null : Boolean(metaRow),
        },
      },
      atualizado_em: agora.toISOString(),
    },
    { requestId },
  );
}
