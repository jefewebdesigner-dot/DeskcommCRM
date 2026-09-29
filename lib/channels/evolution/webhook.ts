/**
 * Webhook da Evolution API (v2.3.x) → o envelope que a ingestão do CRM já entende.
 *
 * NÃO há regra de negócio aqui e nenhuma ingestão paralela. A Evolution fala o mesmo
 * dialeto Baileys que o WAHA/NOWEB (`data.key`, `data.message` com `imageMessage`…,
 * `remoteJidAlt`), então este módulo só TRADUZ o formato e entrega a
 * `dispatchWahaEvent`, que resolve contato, conversa, lead, mídia, ACK, edição,
 * revogação e deduplicação exatamente como faz para os demais canais.
 *
 * Nomes de evento, formatos de `data` e valores de `status`/`state` foram extraídos da
 * imagem v2.3.7 (não de memória):
 *   messages.upsert  → data = { key, pushName, message, messageType, messageTimestamp, source }
 *   messages.update  → data = { messageId, keyId, remoteJid, fromMe, participant, status, instanceId }
 *                       status ∈ PENDING | SERVER_ACK | DELIVERY_ACK | READ | PLAYED | ERROR | DELETED
 *   messages.edited  → data = mensagem editada (mesma forma do upsert)
 *   messages.delete  → data = { key, ... } / { keyId, remoteJid, fromMe }
 *   connection.update→ data = { instance, state, statusReason, wuid, profileName, ... }
 *                       state ∈ open | connecting | close | refused
 *
 * `external_id` = `key.id` cru do Baileys — a mesma convenção do NOWEB, e o que ACK,
 * edição e revogação do CRM casam (`bareWaMessageId`). Duplicata de webhook cai no
 * índice único (organização, external_id) da própria ingestão.
 *
 * Autenticação: a Evolution não assina o corpo; ela reenvia os cabeçalhos configurados
 * na instância. O CRM configura `x-gravity-webhook-secret` com o segredo da sessão
 * (o mesmo `webhook_secret_encrypted` dos demais canais) e confere aqui em tempo
 * constante.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import type { WahaEnvelope } from "@/lib/waha/envelope";

export const CABECALHO_DO_SEGREDO = "x-gravity-webhook-secret";

const texto = z.string().nullish();
const numero = z.number().nullish();
const booleano = z.boolean().nullish();

const chaveSchema = z.looseObject({
  id: texto,
  remoteJid: texto,
  fromMe: booleano,
  participant: texto,
  remoteJidAlt: texto,
  participantAlt: texto,
});

const upsertSchema = z.looseObject({
  key: chaveSchema,
  pushName: texto,
  message: z.unknown().optional(),
  messageType: texto,
  messageTimestamp: z.unknown().optional(),
});

const updateSchema = z.looseObject({
  keyId: texto,
  remoteJid: texto,
  fromMe: booleano,
  status: texto,
});

const conexaoSchema = z.looseObject({
  state: texto,
  statusReason: numero,
});

export const corpoDoWebhookSchema = z.looseObject({
  event: texto,
  instance: texto,
  data: z.unknown().optional(),
});

export type CorpoDoWebhook = z.infer<typeof corpoDoWebhookSchema>;

export type LeituraDoCorpo =
  | { ok: true; corpo: CorpoDoWebhook }
  | { ok: false; motivo: "json_invalido" | "contrato_violado" };

export function lerCorpoDoWebhook(raw: string): LeituraDoCorpo {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, motivo: "json_invalido" };
  }
  const p = corpoDoWebhookSchema.safeParse(json);
  return p.success ? { ok: true, corpo: p.data } : { ok: false, motivo: "contrato_violado" };
}

/** Compara em tempo constante (por digest, para tamanhos diferentes não vazarem por timing). */
export function segredoConfere(recebido: string | null, esperado: string | null): boolean {
  if (!recebido || !esperado || esperado.length < 16) return false;
  const a = createHash("sha256").update(recebido).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}

// ── mensagem ────────────────────────────────────────────────────────────────

/** Chats que o CRM não atende (mesma lista que o WAHA ignora na origem). */
function chatIgnorado(jid: string): boolean {
  return (
    jid.endsWith("@g.us") ||
    jid.endsWith("@broadcast") ||
    jid.endsWith("@newsletter") ||
    jid === "status@broadcast"
  );
}

/** Tipos de `data.messageType` que não são conversa (protocolo interno do WhatsApp). */
const TIPOS_SEM_CONVERSA = new Set([
  "protocolMessage",
  "senderKeyDistributionMessage",
  "messageContextInfo",
  "peerDataOperationRequestMessage",
]);

const TIPO_POR_CHAVE: ReadonlyArray<readonly [string, string]> = [
  ["imageMessage", "image"],
  ["videoMessage", "video"],
  ["ptvMessage", "video"],
  ["audioMessage", "audio"],
  ["documentMessage", "document"],
  ["documentWithCaptionMessage", "document"],
  ["stickerMessage", "sticker"],
  ["contactMessage", "vcard"],
  ["contactsArrayMessage", "vcard"],
  ["locationMessage", "location"],
  ["reactionMessage", "reaction"],
];

const COM_MIDIA = new Set(["image", "video", "audio", "document", "sticker"]);

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** `documentWithCaptionMessage` embrulha o documento de verdade em `.message.documentMessage`. */
function desembrulhar(message: Record<string, unknown>): Record<string, unknown> {
  const embrulho = obj(obj(message.documentWithCaptionMessage)?.message);
  return embrulho ?? message;
}

function textoDaMensagem(message: Record<string, unknown>): string | null {
  const m = desembrulhar(message);
  if (typeof m.conversation === "string") return m.conversation;
  const ext = obj(m.extendedTextMessage);
  if (typeof ext?.text === "string") return ext.text;
  for (const chave of ["imageMessage", "videoMessage", "documentMessage"]) {
    const legenda = obj(m[chave])?.caption;
    if (typeof legenda === "string" && legenda) return legenda;
  }
  const botao = obj(m.buttonsResponseMessage);
  if (typeof botao?.selectedDisplayText === "string") return botao.selectedDisplayText;
  const lista = obj(m.listResponseMessage);
  if (typeof lista?.title === "string") return lista.title;
  const reacao = obj(m.reactionMessage);
  if (typeof reacao?.text === "string") return reacao.text;
  const contato = obj(m.contactMessage);
  if (typeof contato?.vcard === "string") return contato.vcard;
  if (typeof contato?.displayName === "string") return contato.displayName;
  return null;
}

function tipoDaMensagem(message: Record<string, unknown>): string {
  const m = desembrulhar(message);
  for (const [chave, tipo] of TIPO_POR_CHAVE) {
    if (chave in m) {
      // Nota de voz do WhatsApp é `audioMessage` com `ptt: true`.
      if (tipo === "audio" && obj(m.audioMessage)?.ptt === true) return "ptt";
      return tipo;
    }
  }
  return "chat";
}

function mimeDaMensagem(message: Record<string, unknown>): string | null {
  const m = desembrulhar(message);
  for (const chave of ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage", "ptvMessage"]) {
    const mime = obj(m[chave])?.mimetype;
    if (typeof mime === "string") return mime;
  }
  return null;
}

/** `messageTimestamp` vem como número, string ou Long serializado ({ low, high }). Nunca lança. */
function segundosDoTimestamp(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  const o = obj(v);
  if (o && typeof o.low === "number") return o.low;
  return undefined;
}

/** Esquema opaco que SÓ o adapter interpreta (`fetchInboundMedia`); nunca é buscado como URL. */
export const ESQUEMA_DE_MIDIA = "evolution-media:";

export interface ChaveDeMidia {
  id: string;
  remoteJid: string;
  fromMe: boolean;
}

export function urlOpacaDeMidia(chave: ChaveDeMidia): string {
  return `${ESQUEMA_DE_MIDIA}${Buffer.from(JSON.stringify(chave)).toString("base64url")}`;
}

export function chaveDaUrlDeMidia(url: string): ChaveDeMidia | null {
  if (!url.startsWith(ESQUEMA_DE_MIDIA)) return null;
  try {
    const j = obj(JSON.parse(Buffer.from(url.slice(ESQUEMA_DE_MIDIA.length), "base64url").toString("utf8")));
    if (!j || typeof j.id !== "string" || typeof j.remoteJid !== "string") return null;
    return { id: j.id, remoteJid: j.remoteJid, fromMe: j.fromMe === true };
  } catch {
    return null;
  }
}

function envelopeDeMensagem(instancia: string, dado: z.infer<typeof upsertSchema>): WahaEnvelope | null {
  const chave = dado.key;
  const id = chave.id ?? null;
  const jid = chave.remoteJid ?? null;
  if (!id || !jid || chatIgnorado(jid)) return null;
  if (dado.messageType && TIPOS_SEM_CONVERSA.has(dado.messageType)) return null;

  const message = obj(dado.message);
  if (!message) return null;
  const tipo = tipoDaMensagem(message);
  const corpo = textoDaMensagem(message);
  const mime = mimeDaMensagem(message);
  const midia = COM_MIDIA.has(tipo === "ptt" ? "audio" : tipo);

  return {
    event: "message.any",
    session: instancia,
    payload: {
      id,
      from: jid,
      fromMe: chave.fromMe === true,
      body: corpo,
      type: tipo,
      hasMedia: midia,
      timestamp: segundosDoTimestamp(dado.messageTimestamp),
      ...(midia
        ? {
            media: {
              url: urlOpacaDeMidia({ id, remoteJid: jid, fromMe: chave.fromMe === true }),
              mimetype: mime,
            },
            mimetype: mime,
          }
        : {}),
      _data: {
        pushName: dado.pushName ?? null,
        notifyName: dado.pushName ?? null,
        message,
        key: { remoteJidAlt: chave.remoteJidAlt ?? null, participantAlt: chave.participantAlt ?? null },
      },
    },
  };
}

/**
 * A edição chega dentro de `protocolMessage` (`key.id` = mensagem original,
 * `editedMessage` = o conteúdo novo), direto ou embrulhada em `editedMessage.message`.
 * Formas do Baileys; a confirmação com evento real é item da prova ponta a ponta.
 */
function edicaoDe(message: Record<string, unknown>): { alvoId: string; texto: string | null } | null {
  const proto =
    obj(message.protocolMessage) ?? obj(obj(obj(message.editedMessage)?.message)?.protocolMessage);
  if (!proto) return null;
  const alvoId = obj(proto.key)?.id;
  if (typeof alvoId !== "string" || !alvoId) return null;
  const novo = obj(proto.editedMessage);
  return { alvoId, texto: novo ? textoDaMensagem(novo) : null };
}

// ── ACK / revogação / conexão ───────────────────────────────────────────────

/** Valores numéricos que o CRM já usa (`ackToStatus`): -1 erro · 0 pendente · 1 servidor · 2 entregue · 3 lido · 4 tocado. */
const ACK_POR_STATUS: Record<string, number> = {
  ERROR: -1,
  PENDING: 0,
  SERVER_ACK: 1,
  DELIVERY_ACK: 2,
  READ: 3,
  PLAYED: 4,
};

function envelopeDeAtualizacao(instancia: string, dado: z.infer<typeof updateSchema>): WahaEnvelope | null {
  const id = dado.keyId ?? null;
  const status = (dado.status ?? "").toUpperCase();
  if (!id || !status) return null;
  if (status === "DELETED") {
    return { event: "message.revoked", session: instancia, payload: { id, revokedMessageId: id } };
  }
  const ack = ACK_POR_STATUS[status];
  if (ack === undefined) return null;
  return { event: "message.ack", session: instancia, payload: { id, ack, ackName: status } };
}

/**
 * Estado da conexão → status interno do CRM (`WORKING`, `STOPPED`, `FAILED`, …).
 * `connecting` NÃO vira status aqui: sem QR lido é `SCAN_QR_CODE`, com aparelho já
 * pareado é reconexão (`STARTING`), e o webhook não diz qual. Quem decide é a checagem
 * de saúde (`checkHealth`, que consulta o dono da instância) — e um `connecting`
 * transitório não pode acender alerta.
 */
export function statusInternoDaConexao(state: string | null | undefined): string | null {
  switch ((state ?? "").toLowerCase()) {
    case "open":
      return "WORKING";
    case "close":
      return "STOPPED";
    case "refused":
      return "FAILED";
    default:
      return null;
  }
}

function envelopeDeConexao(instancia: string, dado: z.infer<typeof conexaoSchema>): WahaEnvelope | null {
  const status = statusInternoDaConexao(dado.state);
  return status ? { event: "session.status", session: instancia, payload: { status } } : null;
}

/**
 * Traduz UM webhook da Evolution para o envelope WAHA (ou `null` para o que o CRM
 * ignora de propósito: grupos, status, protocolo interno, eventos não assinados).
 */
export function traduzirParaEnvelope(corpo: CorpoDoWebhook, instancia: string): WahaEnvelope | null {
  const evento = (corpo.event ?? "").toLowerCase();
  const dado = Array.isArray(corpo.data) ? corpo.data[0] : corpo.data;

  if (evento === "messages.upsert") {
    const p = upsertSchema.safeParse(dado);
    return p.success ? envelopeDeMensagem(instancia, p.data) : null;
  }
  if (evento === "messages.edited") {
    const p = upsertSchema.safeParse(dado);
    if (!p.success) return null;
    const message = obj(p.data.message);
    const edicao = message ? edicaoDe(message) : null;
    if (edicao) {
      return {
        event: "message.edited",
        session: instancia,
        payload: { id: edicao.alvoId, editedMessageId: edicao.alvoId, body: edicao.texto },
      };
    }
    // Forma alternativa: o evento já traz a mensagem editada com o id original.
    const env = envelopeDeMensagem(instancia, p.data);
    const id = env?.payload?.id ?? null;
    return id
      ? { event: "message.edited", session: instancia, payload: { id, editedMessageId: id, body: env?.payload?.body ?? null } }
      : null;
  }
  if (evento === "messages.update") {
    const p = updateSchema.safeParse(dado);
    return p.success ? envelopeDeAtualizacao(instancia, p.data) : null;
  }
  if (evento === "messages.delete") {
    const o = obj(dado);
    const chave = obj(o?.key);
    const id = (typeof o?.keyId === "string" ? o.keyId : null) ?? (typeof chave?.id === "string" ? chave.id : null);
    return id ? { event: "message.revoked", session: instancia, payload: { id, revokedMessageId: id } } : null;
  }
  if (evento === "connection.update") {
    const p = conexaoSchema.safeParse(dado);
    return p.success ? envelopeDeConexao(instancia, p.data) : null;
  }
  return null;
}
