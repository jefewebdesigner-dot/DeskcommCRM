export type ModoDeRecuperacao = "retomar" | "reparear" | null;

/**
 * STOPPED ainda preserva a credencial no WAHA: o caminho seguro é start de novo,
 * sem logout. FAILED só chega ao reparo por QR depois que a retomada suave falhou.
 */
export function modoDeRecuperacaoDoWhatsapp(status: string): ModoDeRecuperacao {
  const normalizado = String(status || "").toUpperCase();
  if (normalizado === "STOPPED") return "retomar";
  if (normalizado === "FAILED") return "reparear";
  return null;
}
