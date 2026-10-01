export type ValorAutoPreenchivel = string | number | boolean;
export type CamposDaConversa = Record<string, ValorAutoPreenchivel>;

export interface CampoDeclaradoDoFunil {
  key: string;
  label: string;
  type: string;
  options?: unknown;
}

interface MarcaDaIa {
  value: ValorAutoPreenchivel;
  updated_at: string;
  agent_id: string;
}

type MapaDaIa = Record<string, MarcaDaIa>;

export const CHAVE_DE_PROVENIENCIA_DA_IA = "__ia_autofill";
const CHAVES_PROIBIDAS = new Set(["__proto__", "constructor", "prototype"]);

function objeto(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function camposDeclaradosDoFunil(settings: unknown): CampoDeclaradoDoFunil[] {
  const fields = objeto(settings).fields;
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((raw) => {
    const row = objeto(raw);
    const key = typeof row.key === "string" ? row.key.trim() : "";
    const label = typeof row.label === "string" ? row.label.trim() : key;
    const type = typeof row.type === "string" ? row.type.trim() : "text";
    if (!key || key === CHAVE_DE_PROVENIENCIA_DA_IA || CHAVES_PROIBIDAS.has(key)) return [];
    return [{ key, label: label || key, type, options: row.options }];
  });
}

function valorVazio(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function mesmoValor(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizar(
  campo: CampoDeclaradoDoFunil,
  value: ValorAutoPreenchivel,
): ValorAutoPreenchivel | null {
  if (campo.type === "number") {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return null;
    const normalized = value.trim().replace(",", ".");
    if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (campo.type === "checkbox" || campo.type === "boolean") {
    return typeof value === "boolean" ? value : null;
  }

  const text = String(value).trim();
  if (!text) return null;
  if (campo.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text.slice(0, 2000);
}

export interface DecisaoDeAutoPreenchimento {
  patch: Record<string, unknown>;
  atualizados: string[];
  protegidos: string[];
  ignorados: string[];
}

/**
 * Política pura do auto-preenchimento:
 * - só chaves declaradas pelo funil;
 * - nunca apaga campo;
 * - campo vazio pode ser preenchido;
 * - campo já escrito pela IA pode evoluir quando surge evidência nova;
 * - campo alterado por humano depois da IA fica protegido.
 */
export function decidirAutoPreenchimento(input: {
  fields: CampoDeclaradoDoFunil[];
  current: Record<string, unknown>;
  proposed: CamposDaConversa;
  agentId: string;
  nowIso: string;
}): DecisaoDeAutoPreenchimento {
  const allowed = new Map(input.fields.map((field) => [field.key, field]));
  const oldMeta = objeto(input.current[CHAVE_DE_PROVENIENCIA_DA_IA]) as MapaDaIa;
  const nextMeta: MapaDaIa = { ...oldMeta };
  const patch: Record<string, unknown> = {};
  const atualizados: string[] = [];
  const protegidos: string[] = [];
  const ignorados: string[] = [];

  for (const [key, raw] of Object.entries(input.proposed)) {
    const field = allowed.get(key);
    if (!field) {
      ignorados.push(key);
      continue;
    }

    const next = normalizar(field, raw);
    if (next === null) {
      ignorados.push(key);
      continue;
    }

    const current = input.current[key];
    const previousAi = objeto(oldMeta[key]);
    const aiOwned =
      Object.prototype.hasOwnProperty.call(previousAi, "value") &&
      mesmoValor(current, previousAi.value);

    if (!valorVazio(current) && !aiOwned) {
      protegidos.push(key);
      continue;
    }

    if (mesmoValor(current, next)) continue;

    patch[key] = next;
    nextMeta[key] = {
      value: next,
      updated_at: input.nowIso,
      agent_id: input.agentId,
    };
    atualizados.push(key);
  }

  if (atualizados.length > 0) {
    patch[CHAVE_DE_PROVENIENCIA_DA_IA] = nextMeta;
  }
  return { patch, atualizados, protegidos, ignorados };
}
