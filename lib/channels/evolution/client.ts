/**
 * Cliente REST mínimo da Evolution API (v2.3.x, Baileys). É o ÚNICO lugar que fala
 * HTTP com a Evolution: Inbox, IA e rotas pedem ao adapter (`lib/channels/adapters/
 * evolution.ts`), que usa este cliente. Caminhos e corpos foram conferidos contra a
 * v2.3.7 real (schemas de validação da própria imagem + sondagem da API), não contra
 * memória.
 *
 * Isolamento: a Evolution é infraestrutura da PLATAFORMA. Cada organização tem a sua
 * instância (`channel_sessions.evolution_instance_name`); nada aqui conhece tenant,
 * cliente ou domínio. `getEvolutionClient()` devolve `null` quando o ambiente não a
 * configura, para o chamador mostrar "transporte não configurado" em vez de quebrar.
 *
 * Auth: header `apikey`. Usa a chave GLOBAL da instalação (server-only, nunca vai ao
 * browser). O token que a criação devolve (`hash`) NÃO é guardado: toda chamada é
 * autorizada pelo servidor do CRM, e o que impede um tenant de tocar a instância de
 * outro é a checagem de `organization_id` da `channel_sessions` antes de chegar aqui.
 *
 * O erro diz o STATUS, nunca o corpo (mesma regra do cliente do WAHA): o corpo de erro
 * da Evolution pode carregar número de telefone e mensagem de cliente.
 */
import { z } from "zod";

/** Mesmos tetos do WAHA: 15s para chamadas comuns, 30s para mídia (a Evolution baixa e converte). */
export const EVOLUTION_TETO_PADRAO_MS = 15_000;
export const EVOLUTION_TETO_DE_MIDIA_MS = 30_000;

/** Estados de conexão que a Evolution v2.3.7 reporta (`connectionState` e `connection.update`). */
export type EvolutionConnectionState = "open" | "connecting" | "close";

export type EvolutionOperation =
  | "create"
  | "connect"
  | "state"
  | "logout"
  | "delete"
  | "webhook"
  | "send"
  | "presence"
  | "numbers"
  | "picture"
  | "media";

/** Erro com operação + status HTTP, sem corpo. `httpStatus` 0 = sem resposta (rede/tempo). */
export class EvolutionError extends Error {
  constructor(
    public readonly operation: EvolutionOperation,
    public readonly httpStatus: number,
    public readonly instanceMissing = false,
  ) {
    super(httpStatus === 0 ? `evolution_${operation}_unreachable` : `evolution_${operation}_${httpStatus}`);
    this.name = "EvolutionError";
  }
}

export interface EvolutionClientOpts {
  tetoMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Eventos de webhook assinados (nomes reais da v2.3.7, extraídos da imagem).
 * `SEND_MESSAGE` fica de fora: o CRM já grava a mensagem ao enviar (com o `key.id` da
 * resposta) e o ACK chega por `MESSAGES_UPDATE`. `QRCODE_UPDATED` também: o QR é
 * consultado por `connect`, e a conexão avisa por `CONNECTION_UPDATE`.
 */
export const EVOLUTION_WEBHOOK_EVENTS = [
  "CONNECTION_UPDATE",
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "MESSAGES_EDITED",
  "MESSAGES_DELETE",
] as const;

const stateSchema = z.object({
  instance: z.object({ instanceName: z.string().optional(), state: z.string() }).passthrough(),
});

const instanciaSchema = z
  .object({
    connectionStatus: z.string(),
    ownerJid: z.string().nullish(),
    profileName: z.string().nullish(),
    disconnectionReasonCode: z.number().nullish(),
  })
  .passthrough();

const createSchema = z
  .object({
    instance: z.object({ instanceName: z.string(), status: z.string().optional() }).passthrough(),
    hash: z.string().optional(),
    qrcode: z
      .object({
        base64: z.string().nullish(),
        code: z.string().nullish(),
        pairingCode: z.string().nullish(),
        count: z.number().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const connectSchema = z
  .object({
    base64: z.string().nullish(),
    code: z.string().nullish(),
    pairingCode: z.string().nullish(),
    count: z.number().nullish(),
  })
  .passthrough();

const sendResponseSchema = z
  .object({
    key: z
      .object({ id: z.string(), remoteJid: z.string().nullish(), fromMe: z.boolean().nullish() })
      .passthrough(),
  })
  .passthrough();

const numbersSchema = z.array(
  z
    .object({ exists: z.boolean().optional(), jid: z.string().nullish(), number: z.string().nullish() })
    .passthrough(),
);

const pictureSchema = z
  .object({ wuid: z.string().nullish(), profilePictureUrl: z.string().nullish() })
  .passthrough();

const base64MediaSchema = z
  .object({
    base64: z.string(),
    mimetype: z.string().nullish(),
    fileName: z.string().nullish(),
    mediaType: z.string().nullish(),
  })
  .passthrough();

export interface EvolutionQuotedKey {
  id: string;
  remoteJid?: string;
  fromMe?: boolean;
}

export interface EvolutionSendResult {
  /** id cru da mensagem no WhatsApp (`key.id`). */
  keyId: string;
  remoteJid: string | null;
  fromMe: boolean;
}

export interface EvolutionQr {
  /** PNG em bytes, já decodificado do `data:image/png;base64,...`. */
  png: Uint8Array | null;
  /** Código de pareamento por número (`XXXX-XXXX`), quando pedido com `number`. */
  pairingCode: string | null;
  /** Quantas vezes o QR foi regerado (a Evolution limita por `QRCODE_LIMIT`). */
  count: number | null;
}

function pngDeDataUrl(base64: string | null | undefined): Uint8Array | null {
  if (!base64) return null;
  const puro = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  const bytes = Buffer.from(puro, "base64");
  return bytes.length ? new Uint8Array(bytes) : null;
}

export class EvolutionClient {
  private readonly tetoMs: number;
  private readonly doFetch: typeof fetch;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    opts: EvolutionClientOpts = {},
  ) {
    this.tetoMs = opts.tetoMs ?? EVOLUTION_TETO_PADRAO_MS;
    this.doFetch = opts.fetchImpl ?? fetch;
  }

  private url(caminho: string): string {
    return `${this.baseUrl.replace(/\/+$/, "")}${caminho}`;
  }

  private async chamar(
    operation: EvolutionOperation,
    method: "GET" | "POST" | "DELETE",
    caminho: string,
    corpo?: unknown,
    tetoMs?: number,
  ): Promise<{ status: number; json: unknown }> {
    let res: Response;
    try {
      res = await this.doFetch(this.url(caminho), {
        method,
        cache: "no-store",
        signal: AbortSignal.timeout(tetoMs ?? this.tetoMs),
        headers: {
          apikey: this.apiKey,
          ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      });
    } catch {
      throw new EvolutionError(operation, 0);
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      // 404 com "instance does not exist" = a instância não existe do lado da Evolution.
      throw new EvolutionError(operation, res.status, res.status === 404);
    }
    return { status: res.status, json };
  }

  /** Cria a instância Baileys já com o webhook da organização. Devolve o QR inicial. */
  async createInstance(input: {
    instanceName: string;
    webhookUrl: string;
    webhookHeaders: Record<string, string>;
  }): Promise<{ instanceName: string; qr: EvolutionQr }> {
    const { json } = await this.chamar("create", "POST", "/instance/create", {
      instanceName: input.instanceName,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      // O CRM só atende conversa 1-a-1: grupos e status nem entram (economia na fonte).
      groupsIgnore: true,
      rejectCall: false,
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
      webhook: {
        url: input.webhookUrl,
        byEvents: false,
        base64: false,
        headers: input.webhookHeaders,
        events: [...EVOLUTION_WEBHOOK_EVENTS],
      },
    });
    const p = createSchema.parse(json);
    return {
      instanceName: p.instance.instanceName,
      qr: {
        png: pngDeDataUrl(p.qrcode?.base64),
        pairingCode: p.qrcode?.pairingCode ?? null,
        count: p.qrcode?.count ?? null,
      },
    };
  }

  /** QR atual (ou código de pareamento, se `number` for informado). */
  async connect(instanceName: string, number?: string): Promise<EvolutionQr> {
    const q = number ? `?number=${encodeURIComponent(number)}` : "";
    const { json } = await this.chamar("connect", "GET", `/instance/connect/${encodeURIComponent(instanceName)}${q}`);
    const p = connectSchema.parse(json);
    return { png: pngDeDataUrl(p.base64), pairingCode: p.pairingCode ?? null, count: p.count ?? null };
  }

  /**
   * Estado + dono da instância numa consulta só. `ownerJid` preenchido = o aparelho já
   * foi pareado alguma vez; é o que separa `connecting` de "aguardando QR" de
   * "reconectando" (a saúde interna distingue `SCAN_QR_CODE` de `STARTING`).
   */
  async instanceInfo(instanceName: string): Promise<{
    state: EvolutionConnectionState | string;
    ownerJid: string | null;
    profileName: string | null;
    disconnectionReasonCode: number | null;
  }> {
    const { json } = await this.chamar(
      "state",
      "GET",
      `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`,
    );
    const linha = instanciaSchema.array().parse(json)[0];
    if (!linha) throw new EvolutionError("state", 404, true);
    return {
      state: linha.connectionStatus,
      ownerJid: linha.ownerJid ?? null,
      profileName: linha.profileName ?? null,
      disconnectionReasonCode: linha.disconnectionReasonCode ?? null,
    };
  }

  async connectionState(instanceName: string): Promise<EvolutionConnectionState | string> {
    const { json } = await this.chamar("state", "GET", `/instance/connectionState/${encodeURIComponent(instanceName)}`);
    return stateSchema.parse(json).instance.state;
  }

  async logout(instanceName: string): Promise<void> {
    await this.chamar("logout", "DELETE", `/instance/logout/${encodeURIComponent(instanceName)}`);
  }

  async deleteInstance(instanceName: string): Promise<void> {
    await this.chamar("delete", "DELETE", `/instance/delete/${encodeURIComponent(instanceName)}`);
  }

  /** Reaplica o webhook (URL/cabeçalhos/eventos) numa instância existente. */
  async setWebhook(
    instanceName: string,
    input: { url: string; headers: Record<string, string> },
  ): Promise<void> {
    await this.chamar("webhook", "POST", `/webhook/set/${encodeURIComponent(instanceName)}`, {
      webhook: {
        enabled: true,
        url: input.url,
        byEvents: false,
        base64: false,
        headers: input.headers,
        events: [...EVOLUTION_WEBHOOK_EVENTS],
      },
    });
  }

  private citacao(quoted?: EvolutionQuotedKey | null) {
    return quoted ? { quoted: { key: { id: quoted.id, remoteJid: quoted.remoteJid, fromMe: quoted.fromMe } } } : {};
  }

  async sendText(
    instanceName: string,
    number: string,
    text: string,
    quoted?: EvolutionQuotedKey | null,
  ): Promise<EvolutionSendResult> {
    const { json } = await this.chamar("send", "POST", `/message/sendText/${encodeURIComponent(instanceName)}`, {
      number,
      text,
      ...this.citacao(quoted),
    });
    return this.resultado(json);
  }

  /** `media` = URL pública (assinada) OU base64 puro; a Evolution baixa e converte. */
  async sendMedia(
    instanceName: string,
    number: string,
    input: {
      mediatype: "image" | "video" | "document" | "audio";
      media: string;
      mimetype?: string;
      fileName?: string;
      caption?: string;
      quoted?: EvolutionQuotedKey | null;
    },
  ): Promise<EvolutionSendResult> {
    const { json } = await this.chamar(
      "media",
      "POST",
      `/message/sendMedia/${encodeURIComponent(instanceName)}`,
      {
        number,
        mediatype: input.mediatype,
        media: input.media,
        ...(input.mimetype ? { mimetype: input.mimetype } : {}),
        ...(input.fileName ? { fileName: input.fileName } : {}),
        ...(input.caption ? { caption: input.caption } : {}),
        ...this.citacao(input.quoted),
      },
      EVOLUTION_TETO_DE_MIDIA_MS,
    );
    return this.resultado(json);
  }

  /** Nota de voz (a Evolution converte para opus/ogg). `audio` = URL ou base64. */
  async sendVoice(
    instanceName: string,
    number: string,
    audio: string,
    quoted?: EvolutionQuotedKey | null,
  ): Promise<EvolutionSendResult> {
    const { json } = await this.chamar(
      "media",
      "POST",
      `/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`,
      { number, audio, ...this.citacao(quoted) },
      EVOLUTION_TETO_DE_MIDIA_MS,
    );
    return this.resultado(json);
  }

  async sendContact(
    instanceName: string,
    number: string,
    contact: { fullName: string; phoneNumber: string; wuid?: string },
  ): Promise<EvolutionSendResult> {
    const { json } = await this.chamar("send", "POST", `/message/sendContact/${encodeURIComponent(instanceName)}`, {
      number,
      contact: [{ fullName: contact.fullName, phoneNumber: contact.phoneNumber, ...(contact.wuid ? { wuid: contact.wuid } : {}) }],
    });
    return this.resultado(json);
  }

  /** "digitando…" — `presence`: composing | recording | paused | available | unavailable. */
  async sendPresence(
    instanceName: string,
    number: string,
    presence: "composing" | "recording" | "paused" | "available" | "unavailable",
    delayMs = 1200,
  ): Promise<void> {
    await this.chamar("presence", "POST", `/chat/sendPresence/${encodeURIComponent(instanceName)}`, {
      number,
      presence,
      delay: delayMs,
    });
  }

  /** O número tem WhatsApp? Devolve o JID canônico quando tem. */
  async whatsappNumber(instanceName: string, number: string): Promise<string | null> {
    const { json } = await this.chamar("numbers", "POST", `/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`, {
      numbers: [number],
    });
    const linha = numbersSchema.parse(json)[0];
    return linha?.exists && linha.jid ? linha.jid : null;
  }

  async profilePictureUrl(instanceName: string, number: string): Promise<string | null> {
    const { json } = await this.chamar(
      "picture",
      "POST",
      `/chat/fetchProfilePictureUrl/${encodeURIComponent(instanceName)}`,
      { number },
    );
    return pictureSchema.parse(json).profilePictureUrl ?? null;
  }

  /** Mídia recebida: a Evolution guarda a mensagem; pedimos o conteúdo em base64 pela chave dela. */
  async mediaBase64(
    instanceName: string,
    key: { id: string; remoteJid?: string; fromMe?: boolean },
  ): Promise<{ base64: string; mimetype: string | null; fileName: string | null }> {
    const { json } = await this.chamar(
      "media",
      "POST",
      `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
      { message: { key } },
      EVOLUTION_TETO_DE_MIDIA_MS,
    );
    const p = base64MediaSchema.parse(json);
    return { base64: p.base64, mimetype: p.mimetype ?? null, fileName: p.fileName ?? null };
  }

  private resultado(json: unknown): EvolutionSendResult {
    const p = sendResponseSchema.parse(json);
    return { keyId: p.key.id, remoteJid: p.key.remoteJid ?? null, fromMe: p.key.fromMe ?? true };
  }
}

/** Placeholder que nunca deve chegar a produção (mesma guarda do WAHA). */
const PLACEHOLDER_DA_CHAVE = "dev_plaintext_change_me";

/**
 * Cliente do ambiente (`EVOLUTION_API_BASE_URL` + `EVOLUTION_API_KEY`), ou `null`.
 * Lê `process.env` a cada chamada de propósito: o teste e o Vercel trocam o valor sem reimportar.
 */
export function getEvolutionClient(
  env: Record<string, string | undefined> = process.env,
): EvolutionClient | null {
  const base = (env.EVOLUTION_API_BASE_URL ?? "").trim();
  const chave = (env.EVOLUTION_API_KEY ?? "").trim();
  if (!base || !chave || chave === PLACEHOLDER_DA_CHAVE) return null;
  return new EvolutionClient(base, chave);
}
