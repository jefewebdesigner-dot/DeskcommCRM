/**
 * `/api/v1/public/agenda/[eventTypeId]` — agendamento sem login.
 *
 * Substitui o link do Calendly: a página pública (`app/agendar/[eventTypeId]`)
 * chama esta rota pelo navegador de quem está agendando — nunca autenticado,
 * nunca com cookie de organização. O `eventTypeId` É o token do link: não é
 * secreto (é um uuid num botão "copiar link de agendamento"), mas sozinho não
 * entrega nada sensível — só nome/duração do tipo e horários livres.
 *
 * GET devolve os horários livres reaproveitando `horariosLivresDaOrg` (o MESMO
 * motor da tela interna e da ferramenta MCP do agente — uma régua, três
 * consumidores). POST marca de verdade, reaproveitando `createContactHandler`
 * (achar/criar contato pelo telefone) e `marcarAgendamentoHandler` — a
 * identidade de serviço (`createAdminClient`) é quem assina as duas escritas,
 * e por isso drena o `event_log` inline no fim (mesmo padrão de
 * `agenda/agendamentos/_handler.ts`): sem cron de minuto nesta instalação, a
 * confirmação por WhatsApp (automation_rules) ficaria presa em `pending`.
 *
 * Rate limit por IP nos dois verbos — é pública, então é superfície de abuso
 * (GET: varredura de agenda; POST: spam de agendamento/contato).
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { horariosLivresDaOrg, MAXIMO_DE_DIAS } from "@/lib/agenda/consulta";
import { fail, ok } from "@/lib/api/wrappers";
import { ApiError } from "@/lib/api/types";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { createContactHandler } from "@/app/api/v1/contacts/_handler";
import { marcarAgendamentoHandler } from "@/app/api/v1/agenda/agendamentos/_handler";
import { encontrarContatoPorTelefone } from "@/lib/channels/contato-por-telefone";
import { canonicalPhoneBR } from "@/lib/channels/phone-variants";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ eventTypeId: string }>;
}

function clientIp(req: NextRequest): string | null {
  const encaminhado = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (encaminhado) return encaminhado;
  return req.headers.get("x-real-ip")?.trim() || null;
}

/** Converte entrada solta (com ou sem DDI, com máscara) em E.164 BR. */
function normalizarTelefonePublico(raw: string): string {
  const digitos = raw.replace(/\D/g, "");
  const comDdi = digitos.startsWith("55") ? digitos : `55${digitos}`;
  return canonicalPhoneBR(`+${comDdi}`);
}

const GET_TETO_POR_IP = 30;
const GET_JANELA_SEGUNDOS = 60;
const POST_TETO_POR_IP = 5;
const POST_JANELA_SEGUNDOS = 600;

const querySchema = z.object({
  de: z.string().datetime({ offset: true }).optional(),
  ate: z.string().datetime({ offset: true }).optional(),
});

const marcarPublicoSchema = z.object({
  nome: z.string().trim().min(1).max(200),
  telefone: z.string().trim().min(8).max(20),
  starts_at: z.string().datetime({ offset: true }),
});

/** Linha pública do tipo — só o que um link de agendamento pode mostrar. */
async function resolverTipoPublico(
  admin: ReturnType<typeof createAdminClient>,
  eventTypeId: string,
): Promise<{ organizationId: string; nome: string; duracaoMin: number; bookingWindowDays: number | null } | null> {
  const { data, error } = await admin
    .from("calendar_event_types")
    .select("organization_id, name, duration_minutes, is_active, booking_window_days")
    .eq("id", eventTypeId)
    .maybeSingle();
  if (error || !data || !data.is_active) return null;
  return {
    organizationId: data.organization_id,
    nome: data.name,
    duracaoMin: data.duration_minutes,
    bookingWindowDays: data.booking_window_days ?? null,
  };
}

export async function GET(req: NextRequest, routeCtx: RouteContext): Promise<Response> {
  const requestId = randomUUID();
  const { eventTypeId } = await routeCtx.params;
  if (!z.string().uuid().safeParse(eventTypeId).success) {
    return fail("not_found", "Link de agendamento inválido.", 404, { requestId });
  }

  const ip = clientIp(req);
  if (ip !== null) {
    const limite = await checkRateLimit(`public-agenda:get:${ip}`, GET_TETO_POR_IP, GET_JANELA_SEGUNDOS);
    if (!limite.allowed) {
      return fail("rate_limited", "Muitas consultas. Tente de novo em um minuto.", 429, {
        requestId,
        headers: { "Retry-After": String(GET_JANELA_SEGUNDOS) },
      });
    }
  }

  const admin = createAdminClient();
  const tipo = await resolverTipoPublico(admin, eventTypeId);
  if (!tipo) {
    return fail("not_found", "Link de agendamento inválido ou desativado.", 404, { requestId });
  }

  const url = new URL(req.url);
  const query = querySchema.safeParse({
    de: url.searchParams.get("de") ?? undefined,
    ate: url.searchParams.get("ate") ?? undefined,
  });
  if (!query.success) {
    return fail("validation_failed", "Parâmetros inválidos.", 422, { requestId });
  }

  const agora = new Date();
  const de = query.data.de ? new Date(query.data.de) : agora;
  const tetoDeDias = Math.min(tipo.bookingWindowDays ?? MAXIMO_DE_DIAS, MAXIMO_DE_DIAS);
  const ateMax = new Date(agora.getTime() + tetoDeDias * 86_400_000);
  const ate = query.data.ate ? new Date(Math.min(new Date(query.data.ate).getTime(), ateMax.getTime())) : ateMax;

  const resultado = await horariosLivresDaOrg(admin, tipo.organizationId, {
    eventTypeId,
    de,
    ate,
    agora,
  });

  if (!resultado.ok) {
    // `motivoParaCliente` já nasce seguro para sair da organização (lib/agenda/consulta.ts).
    return fail("agenda_indisponivel", resultado.motivoParaCliente, 422, { requestId });
  }

  return ok(
    {
      tipo: { nome: tipo.nome, duracao_minutos: tipo.duracaoMin },
      timezone: resultado.fusoDaRegra,
      slots: resultado.slots.map((s) => ({ inicio: s.inicio.toISOString(), fim: s.fim.toISOString() })),
    },
    { requestId },
  );
}

export async function POST(req: NextRequest, routeCtx: RouteContext): Promise<Response> {
  const requestId = randomUUID();
  const { eventTypeId } = await routeCtx.params;
  if (!z.string().uuid().safeParse(eventTypeId).success) {
    return fail("not_found", "Link de agendamento inválido.", 404, { requestId });
  }

  const ip = clientIp(req);
  if (ip !== null) {
    const limite = await checkRateLimit(`public-agenda:post:${ip}`, POST_TETO_POR_IP, POST_JANELA_SEGUNDOS);
    if (!limite.allowed) {
      return fail("rate_limited", "Muitas tentativas de agendamento. Tente de novo mais tarde.", 429, {
        requestId,
        headers: { "Retry-After": String(POST_JANELA_SEGUNDOS) },
      });
    }
  }

  const parsed = marcarPublicoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }

  const admin = createAdminClient();
  const tipo = await resolverTipoPublico(admin, eventTypeId);
  if (!tipo) {
    return fail("not_found", "Link de agendamento inválido ou desativado.", 404, { requestId });
  }

  const telefone = normalizarTelefonePublico(parsed.data.telefone);
  const ctx = {
    organization_id: tipo.organizationId,
    actor: { type: "webhook_source" as const, id: "public_booking" },
    requestId,
  };

  try {
    let contactId: string;
    const existente = await encontrarContatoPorTelefone(admin, tipo.organizationId, telefone);
    if (existente) {
      contactId = existente.id;
    } else {
      const criado = await createContactHandler(admin, ctx, {
        name: parsed.data.nome,
        phone_number: telefone,
        source: "public_booking",
      });
      contactId = criado.contact.id;
    }

    // marcarAgendamentoHandler já drena o event_log inline (ver seu próprio
    // cabeçalho) — sem isto a confirmação por WhatsApp (automation_rules em
    // appointment.created) ficaria presa em `pending`.
    const agendamento = await marcarAgendamentoHandler(admin, ctx, {
      event_type_id: eventTypeId,
      starts_at: parsed.data.starts_at,
      contact_id: contactId,
    });

    return ok(
      { tipo: { nome: tipo.nome }, agendamento: { id: agendamento.id, starts_at: agendamento.starts_at } },
      { requestId, status: 201 },
    );
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { requestId });
    }
    logger.error("[public-agenda] marcação pública falhou", {
      error: err instanceof Error ? err.message : String(err),
      requestId,
    });
    return fail("internal_error", "Não foi possível agendar agora. Tente de novo.", 500, { requestId });
  }
}
