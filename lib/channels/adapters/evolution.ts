/**
 * Adapter da Evolution API (Baileys) — só TRADUZ formato entre o CRM e o transporte.
 *
 * Mesma disciplina dos demais adapters (`docs/doctrine/restricao-de-canal.md`): não
 * decide se pode enviar (janela, cap, horário, throttle são da cadeia `before_send`) e
 * não conhece tenant, cliente nem domínio — recebe `sessionRef` (o nome da instância
 * desta organização) e o resolve no cliente do ambiente. Toda chamada HTTP mora em
 * `lib/channels/evolution/client.ts`.
 *
 * `external_id` de mensagem = `key.id` cru do Baileys, a mesma convenção do NOWEB
 * (é o que ACK, edição e revogação do CRM casam). O eco do próprio envio volta por
 * `messages.upsert` com o MESMO id, então a deduplicação da ingestão o reconhece.
 */
import { EvolutionError, getEvolutionClient } from "@/lib/channels/evolution/client";
import { statusInternoDaInstancia } from "@/lib/channels/evolution/estado";
import { chaveDaUrlDeMidia } from "@/lib/channels/evolution/webhook";
import { MAX_MEDIA_BYTES, MediaTooLargeError, type FetchedMedia } from "@/lib/messaging/media/types";

import { DETALHE_CREDENCIAL_RECUSADA } from "../health";
import type {
  ChannelAdapter,
  ChannelHealth,
  OutboundEnvelope,
  PairingCodeResult,
  PairingQrResult,
  RecipientInput,
} from "../types";

export { statusInternoDaInstancia };

function digitos(v: string): string {
  return v.replace(/\D/g, "");
}

function bare(externalId: string): string {
  const corte = externalId.lastIndexOf("_");
  return corte === -1 ? externalId : externalId.slice(corte + 1);
}

/** `ABCD1234` → `ABCD-1234` (o formato que a tela mostra e o WhatsApp aceita). */
function formatarCodigo(codigo: string): string | null {
  const limpo = codigo.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return /^[A-Z0-9]{8}$/.test(limpo) ? `${limpo.slice(0, 4)}-${limpo.slice(4)}` : null;
}

const TIPO_DA_MIDIA: Record<string, "image" | "video" | "document"> = {
  image: "image",
  video: "video",
};

export const evolutionAdapter: ChannelAdapter = {
  provider: "evolution",

  resolveRecipient(input: RecipientInput): string | null {
    if (input.isGroup && input.groupChatId) return input.groupChatId;
    if (input.waLid) return `${input.waLid}@lid`;
    if (input.waIdentity?.startsWith("lid:")) return `${input.waIdentity.slice(4)}@lid`;
    // A Evolution normaliza o dígito 9 e o sufixo por conta própria (`onWhatsApp`).
    const d = input.phoneNumber ? digitos(input.phoneNumber) : "";
    return d || null;
  },

  echoExternalIds(input: { externalId: string; recipient: string }): string[] {
    const cru = bare(input.externalId);
    const numero = digitos(input.recipient);
    return [
      ...new Set([
        input.externalId,
        cru,
        `true_${input.recipient}_${cru}`,
        `true_${numero}@s.whatsapp.net_${cru}`,
      ]),
    ];
  },

  isConfigured(): boolean {
    return getEvolutionClient() !== null;
  },

  codes: {
    notConfigured: "evolution_not_configured",
    sendFailed: "evolution_error",
    unknownError: "evolution_unknown",
  },

  async fetchProfilePictureUrl(input: { sessionRef: string; recipient: string }): Promise<string | null> {
    const client = getEvolutionClient();
    if (!client) return null;
    try {
      return await client.profilePictureUrl(input.sessionRef, input.recipient);
    } catch {
      return null;
    }
  },

  async resolveRegisteredPhone(input: { sessionRef: string; phone: string }): Promise<string | null> {
    const client = getEvolutionClient();
    if (!client) return null;
    try {
      const jid = await client.whatsappNumber(input.sessionRef, digitos(input.phone));
      return jid ? digitos(jid.split("@")[0] ?? "") || null : null;
    } catch {
      return null;
    }
  },

  async signalTyping(input: { sessionRef: string; recipient: string }): Promise<void> {
    const client = getEvolutionClient();
    if (!client) return;
    await client.sendPresence(input.sessionRef, input.recipient, "composing");
  },

  async checkHealth(input: { sessionRef: string }): Promise<ChannelHealth> {
    const client = getEvolutionClient();
    if (!client) return { reachable: false, status: null, detail: "transporte_nao_configurado" };
    try {
      const info = await client.instanceInfo(input.sessionRef);
      const status = statusInternoDaInstancia(info);
      const detail =
        status === "STOPPED" && info.disconnectionReasonCode ? `motivo_${info.disconnectionReasonCode}` : null;
      return { reachable: true, status, detail };
    } catch (err) {
      if (err instanceof EvolutionError) {
        // A instância não existe no transporte: o mesmo que o WAHA chama de sessão parada.
        if (err.instanceMissing) return { reachable: true, status: "STOPPED", detail: null };
        if (err.httpStatus === 401 || err.httpStatus === 403) {
          return { reachable: false, status: null, detail: DETALHE_CREDENCIAL_RECUSADA };
        }
        return { reachable: false, status: null, detail: err.message.slice(0, 200) };
      }
      return { reachable: false, status: null, detail: "erro_desconhecido" };
    }
  },

  async fetchInboundMedia(input: { sessionRef: string; url: string; hintMime?: string | null }): Promise<FetchedMedia> {
    const client = getEvolutionClient();
    if (!client) throw new Error("evolution_not_configured");
    // O identificador é opaco e nosso: nunca se busca URL arbitrária vinda do payload.
    const chave = chaveDaUrlDeMidia(input.url);
    if (!chave) throw new Error("evolution_media_ref_invalid");
    const m = await client.mediaBase64(input.sessionRef, chave);
    const buffer = Buffer.from(m.base64.includes(",") ? m.base64.slice(m.base64.indexOf(",") + 1) : m.base64, "base64");
    if (buffer.length > MAX_MEDIA_BYTES) throw new MediaTooLargeError();
    return { buffer, mime: m.mimetype ?? input.hintMime ?? "application/octet-stream" };
  },

  async fetchPairingQr(input: { sessionRef: string }): Promise<PairingQrResult> {
    const client = getEvolutionClient();
    if (!client) return { kind: "unavailable", httpStatus: 503 };
    try {
      const qr = await client.connect(input.sessionRef);
      return qr.png ? { kind: "image", contentType: "image/png", bytes: qr.png } : { kind: "pending" };
    } catch (err) {
      const http = err instanceof EvolutionError ? err.httpStatus : 0;
      return { kind: "unavailable", httpStatus: http === 0 ? 502 : http };
    }
  },

  async requestPairingCode(input: { sessionRef: string; phone: string }): Promise<PairingCodeResult> {
    const client = getEvolutionClient();
    if (!client) return { kind: "unavailable" };
    try {
      const info = await client.instanceInfo(input.sessionRef);
      if (info.state.toLowerCase() === "open") return { kind: "already_connected" };
      if (info.state.toLowerCase() !== "connecting") return { kind: "not_ready" };
      const qr = await client.connect(input.sessionRef, digitos(input.phone));
      const codigo = qr.pairingCode ? formatarCodigo(qr.pairingCode) : null;
      return codigo ? { kind: "code", code: codigo } : { kind: "failed" };
    } catch {
      return { kind: "unavailable" };
    }
  },

  async send(envelope: OutboundEnvelope): Promise<{ externalId: string | null }> {
    const client = getEvolutionClient();
    if (!client) return { externalId: null };

    const instancia = envelope.sessionRef;
    const para = envelope.to;
    const citada = envelope.replyToExternalId ? { id: envelope.replyToExternalId } : null;

    if (envelope.kind === "contact" && envelope.contact) {
      await envelope.beforeSend?.();
      const r = await client.sendContact(instancia, para, {
        fullName: envelope.contact.fullName,
        phoneNumber: envelope.contact.phoneNumber,
        wuid: digitos(envelope.contact.whatsappId) || undefined,
      });
      return { externalId: r.keyId };
    }

    if (envelope.media) {
      await envelope.beforeSend?.();
      if (envelope.kind === "audio") {
        // Nota de voz: a Evolution converte para opus/ogg (capability `server-convert`).
        const r = await client.sendVoice(instancia, para, envelope.media.url, citada);
        return { externalId: r.keyId };
      }
      const r = await client.sendMedia(instancia, para, {
        mediatype: TIPO_DA_MIDIA[envelope.kind] ?? "document",
        media: envelope.media.url,
        mimetype: envelope.media.mime,
        fileName: envelope.media.filename ?? undefined,
        caption: envelope.media.caption ?? undefined,
        quoted: citada,
      });
      return { externalId: r.keyId };
    }

    await envelope.beforeSend?.();
    const r = await client.sendText(instancia, para, envelope.body ?? "", citada);
    return { externalId: r.keyId };
  },
};
