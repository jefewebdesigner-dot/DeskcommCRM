import { createHash } from "node:crypto";

export type TipoDePendenciaDaAgenda = "registrar_resultado" | "definir_proximo_passo";

export interface CompromissoParaPendencia {
  id: string;
  contact_id: string | null;
  status: string;
  ends_at: string;
  outcome_recorded_at: string | null;
}

const TRINTA_MINUTOS = 30 * 60_000;
const UMA_HORA = 60 * 60_000;

/**
 * Decide se um compromisso já deveria ter virado trabalho operacional.
 *
 * - Horário passou + ninguém registrou presença/falta → alguém precisa fechar o fato.
 * - Presença/falta registrada + nenhum próximo passo → alguém precisa decidir a ação seguinte.
 *
 * As folgas evitam criar tarefa enquanto a reunião ainda está sendo encerrada na tela.
 */
export function pendenciaOperacionalDaAgenda(input: {
  compromisso: CompromissoParaPendencia;
  agora: Date;
  temTarefaAbertaDoContato: boolean;
}): TipoDePendenciaDaAgenda | null {
  const { compromisso, agora, temTarefaAbertaDoContato } = input;
  if (!compromisso.contact_id) return null;
  if (compromisso.status === "cancelled") return null;

  const terminouEm = Date.parse(compromisso.ends_at);
  if (!Number.isFinite(terminouEm) || terminouEm + TRINTA_MINUTOS > agora.getTime()) return null;

  if (
    ["pending", "confirmed"].includes(compromisso.status) &&
    !compromisso.outcome_recorded_at
  ) {
    return "registrar_resultado";
  }

  if (
    ["completed", "no_show"].includes(compromisso.status) &&
    compromisso.outcome_recorded_at &&
    !temTarefaAbertaDoContato
  ) {
    const resultadoEm = Date.parse(compromisso.outcome_recorded_at);
    if (Number.isFinite(resultadoEm) && resultadoEm + UMA_HORA <= agora.getTime()) {
      return "definir_proximo_passo";
    }
  }

  return null;
}

/**
 * Um compromisso + um tipo de pendência geram sempre o MESMO UUID.
 * Isso transforma o cron em idempotente sem criar coluna nova só para dedupe.
 */
export function idDaTarefaAutomaticaDaAgenda(
  compromissoId: string,
  tipo: TipoDePendenciaDaAgenda,
): string {
  const bytes = createHash("sha256")
    .update(`agenda:${compromissoId}:${tipo}`)
    .digest()
    .subarray(0, 16);
  // UUID v5-compatible bits; o valor é determinístico e continua aceito por `uuid` no Postgres.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
