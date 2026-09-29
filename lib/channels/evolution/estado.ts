/**
 * Mapa puro estado-da-Evolution → status interno de saúde. Mora sozinho (sem imports) porque
 * o worker do agent-engine roda em strip-types e não deve puxar o adapter inteiro só por isto.
 */
export function statusInternoDaInstancia(input: {
  state: string;
  ownerJid: string | null;
}): string | null {
  switch (input.state.toLowerCase()) {
    case "open":
      return "WORKING";
    // Sem aparelho pareado, `connecting` é o QR esperando ser lido; com aparelho já
    // pareado é reconexão em curso — e reconexão transitória não pode acender alerta.
    case "connecting":
      return input.ownerJid ? "STARTING" : "SCAN_QR_CODE";
    case "close":
      return "STOPPED";
    case "refused":
      return "FAILED";
    default:
      return null;
  }
}
