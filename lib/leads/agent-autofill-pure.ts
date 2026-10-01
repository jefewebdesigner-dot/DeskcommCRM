export type CampoDoFunil = {
  key: string;
  label: string;
  type: string;
};

function objeto(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function valorEstaVazio(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

export function camposDeclaradosDoFunil(settings: unknown): CampoDoFunil[] {
  const fields = objeto(settings).fields;
  if (!Array.isArray(fields)) return [];

  return fields.flatMap((raw) => {
    const row = objeto(raw);
    const key = typeof row.key === "string" ? row.key.trim() : "";
    const label = typeof row.label === "string" ? row.label.trim() : key;
    const type = typeof row.type === "string" ? row.type.trim() : "text";
    if (!key || !/^[a-zA-Z0-9_-]{1,80}$/.test(key)) return [];
    return [{ key, label: label || key, type }];
  });
}

function normalizarValor(type: string, value: unknown): string | number | boolean | undefined {
  const tipo = type.trim().toLowerCase();

  if (tipo === "number") {
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
    if (typeof value !== "string") return undefined;
    const texto = value.trim();
    if (!texto) return undefined;
    const numero = Number(texto.replace(",", "."));
    return Number.isFinite(numero) ? numero : undefined;
  }

  if (tipo === "boolean" || tipo === "checkbox") {
    return typeof value === "boolean" ? value : undefined;
  }

  if (tipo === "date") {
    if (typeof value !== "string") return undefined;
    const texto = value.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : undefined;
  }

  // Campos textuais/select não aceitam objeto, array, número ou booleano. A IA
  // precisa devolver o valor na mesma forma que o formulário humano grava.
  if (typeof value !== "string") return undefined;
  const texto = value.trim();
  return texto && texto.length <= 2000 ? texto : undefined;
}

/**
 * Regra pura do que PODE subir para custom_fields.
 *
 * Configuração do funil + campo ainda vazio vencem qualquer payload da IA.
 * Isso impede chave inventada e impede a máquina de pisar em edição humana.
 */
export function prepararPatchDeAutopreenchimento(input: {
  settings: unknown;
  atuais: unknown;
  propostos: Record<string, unknown>;
}): Record<string, string | number | boolean> {
  const atuais = objeto(input.atuais);
  const declarados = new Map(camposDeclaradosDoFunil(input.settings).map((f) => [f.key, f]));
  const patch: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(input.propostos)) {
    const field = declarados.get(key);
    if (!field || !valorEstaVazio(atuais[key])) continue;
    const normalizado = normalizarValor(field.type, value);
    if (normalizado !== undefined) patch[key] = normalizado;
  }

  return patch;
}
