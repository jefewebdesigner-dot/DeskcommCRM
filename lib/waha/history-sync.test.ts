import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/waha/ingest", () => ({
  parseChatId: (id: string) =>
    id.endsWith("@g.us")
      ? { kind: "group" }
      : id.includes("@")
        ? { kind: "phone" }
        : { kind: "unknown" },
  persistirMensagemHistoricaWaha: vi.fn(),
  resolveMessageType: (p: { id?: string | null }) =>
    p.id === "TXT" ? "text" : "audio",
  mediaUrlOf: (p: { mediaUrl?: string | null; media?: { url?: string | null } | null }) =>
    p.mediaUrl ?? p.media?.url ?? null,
  mediaMimeOf: (p: { mimetype?: string | null; media?: { mimetype?: string | null } | null }) =>
    p.mimetype ?? p.media?.mimetype ?? null,
}));

import type { WahaClient } from "@/lib/waha/client";
import {
  hidratarMidiaHistoricaWaha,
  hidratarMidiaHistoricaWahaPorBanco,
} from "@/lib/waha/history-sync";
import { payloadHistoricoDoStore } from "@/lib/waha/history-normalization";
import type { Admin } from "@/lib/waha/ingest";

describe("payloadHistoricoDoStore", () => {
  it("aceita o formato de WAMessage do store", () => {
    const payload = payloadHistoricoDoStore({
      id: "ABC123",
      timestamp: 1_790_000_000,
      from: "554799999999@s.whatsapp.net",
      to: "554788888888@s.whatsapp.net",
      fromMe: false,
      body: "Olá",
      hasMedia: false,
      ack: 3,
      ackName: "READ",
      _data: { key: { remoteJidAlt: "554799999999@s.whatsapp.net" } },
    });

    expect(payload).toMatchObject({ id: "ABC123", body: "Olá", fromMe: false });
  });

  it("recusa campo tipado em formato incompatível", () => {
    expect(
      payloadHistoricoDoStore({ id: 123, fromMe: "não", body: { texto: "x" } }),
    ).toBeNull();
  });
});

describe("hidratarMidiaHistoricaWaha", () => {
  const chatId = "554799999999@s.whatsapp.net";
  const base = {
    timestamp: 1_790_000_000,
    from: chatId,
    to: "554788888888@s.whatsapp.net",
    fromMe: false,
  };

  function fixture() {
    const eventos: unknown[][] = [];
    const atualizacoes: Record<string, unknown>[] = [];
    const linhas = new Map<string, Record<string, unknown>>([
      ["MIDIA1", {
        id: "db-m1",
        media_url: null,
        media_mime: null,
        media_storage_path: null,
        metadata: { history_import: true },
      }],
      ["MIDIA2", {
        id: "db-m2",
        media_url: null,
        media_mime: null,
        media_storage_path: null,
        metadata: { history_import: true },
      }],
    ]);

    const admin = {
      from(tabela: string) {
        if (tabela !== "messages") throw new Error(`tabela inesperada: ${tabela}`);
        return {
          select() {
            const filtros: Record<string, unknown> = {};
            const chain = {
              eq(campo: string, valor: unknown) {
                filtros[campo] = valor;
                return chain;
              },
              async maybeSingle() {
                const ext = String(filtros.external_id ?? "");
                return { data: linhas.get(ext) ?? null, error: null };
              },
            };
            return chain;
          },
          update(patch: Record<string, unknown>) {
            atualizacoes.push(patch);
            const chain = {
              error: null,
              eq() {
                return chain;
              },
            };
            return chain;
          },
        };
      },
      async rpc(...args: unknown[]) {
        eventos.push(args);
        return { error: null };
      },
    } as unknown as Admin;

    const waha = {
      async listChats(
        _session: string,
        opts: { limit?: number; offset?: number } = {},
      ) {
        return opts.offset === 0 ? [{ id: chatId, name: "Cliente" }] : [];
      },
      async listChatMessages(
        _session: string,
        _chat: string,
        opts: {
          limit?: number;
          offset?: number;
          downloadMedia?: boolean;
        } = {},
      ) {
        const offset = opts.offset ?? 0;
        if (opts.downloadMedia) {
          if (offset === 1) {
            return [{
              ...base,
              id: "MIDIA1",
              hasMedia: true,
              media: {
                url: "http://transport.local/media/1",
                mimetype: "audio/ogg; codecs=opus",
              },
            }];
          }
          if (offset === 2) {
            return [{
              ...base,
              id: "MIDIA2",
              hasMedia: true,
              media: {
                url: "http://transport.local/media/2",
                mimetype: "image/jpeg",
              },
            }];
          }
          return [];
        }

        if (offset === 0) {
          return [
            { ...base, id: "TXT", body: "oi", hasMedia: false },
            { ...base, id: "MIDIA1", body: "", hasMedia: true },
            { ...base, id: "MIDIA2", body: "", hasMedia: true },
          ];
        }
        if (offset === 2) {
          return [{ ...base, id: "MIDIA2", body: "", hasMedia: true }];
        }
        return [];
      },
    } as unknown as WahaClient;

    return { admin, waha, eventos, atualizacoes };
  }

  it("retoma no meio do chat sem pular a mídia seguinte", async () => {
    const f = fixture();
    const session = {
      id: "canal",
      organization_id: "org",
      waha_session_name: "sessao",
    };

    const primeiro = await hidratarMidiaHistoricaWaha(
      f.admin,
      f.waha,
      session,
      { maxMedia: 1, maxMessagesScanned: 100, scanPageSize: 100 },
    );
    expect(primeiro).toMatchObject({
      midias_enfileiradas: 1,
      next_chat_offset: 0,
      next_message_offset: 2,
      completed: false,
    });

    const segundo = await hidratarMidiaHistoricaWaha(
      f.admin,
      f.waha,
      session,
      {
        startChatOffset: primeiro.next_chat_offset ?? 0,
        startMessageOffset: primeiro.next_message_offset ?? 0,
        maxMedia: 1,
        maxMessagesScanned: 100,
        scanPageSize: 100,
      },
    );
    expect(segundo).toMatchObject({
      midias_enfileiradas: 1,
      next_chat_offset: 0,
      next_message_offset: 3,
      completed: false,
    });
    expect(f.eventos).toHaveLength(2);
    expect(f.atualizacoes).toEqual([
      expect.objectContaining({
        media_url: "http://transport.local/media/1",
        media_mime: "audio/ogg; codecs=opus",
      }),
      expect.objectContaining({
        media_url: "http://transport.local/media/2",
        media_mime: "image/jpeg",
      }),
    ]);

    const final = await hidratarMidiaHistoricaWaha(
      f.admin,
      f.waha,
      session,
      {
        startChatOffset: segundo.next_chat_offset ?? 0,
        startMessageOffset: segundo.next_message_offset ?? 0,
        maxMedia: 1,
        maxMessagesScanned: 100,
        scanPageSize: 100,
      },
    );
    expect(final.completed).toBe(true);
    expect(final.next_chat_offset).toBeNull();
    expect(final.next_message_offset).toBeNull();
  });
});


describe("hidratarMidiaHistoricaWahaPorBanco", () => {
  it("usa o banco como índice quando a paginação de chats muda", async () => {
    const eventos: unknown[][] = [];
    const atualizacoes: Record<string, unknown>[] = [];
    const row = {
      id: "00000000-0000-4000-8000-000000000001",
      external_id: "false_554799999999@s.whatsapp.net_MIDIA_DB",
      media_url: null,
      media_mime: null,
      media_storage_path: null,
      metadata: { history_import: true },
      contact_id: "contato",
      type: "audio",
    };

    const thenable = <T>(value: T) => ({
      then(resolve: (v: T) => unknown) {
        return Promise.resolve(value).then(resolve);
      },
    });

    const admin = {
      from(tabela: string) {
        if (tabela === "messages") {
          return {
            select() {
              const chain: any = {
                eq() { return chain; },
                in() { return chain; },
                order() { return chain; },
                limit() { return Object.assign(chain, thenable({ data: [row], error: null })); },
                gt() { return chain; },
              };
              return chain;
            },
            update(patch: Record<string, unknown>) {
              atualizacoes.push(patch);
              const chain: any = {
                eq() { return chain; },
                ...thenable({ error: null }),
              };
              return chain;
            },
          };
        }
        if (tabela === "contacts") {
          return {
            select() {
              const chain: any = {
                eq() { return chain; },
                async maybeSingle() {
                  return {
                    data: {
                      source_metadata: {
                        waha_chat_id: "554799999999@s.whatsapp.net",
                      },
                      wa_lid: null,
                      phone_number: "+554799999999",
                    },
                    error: null,
                  };
                },
              };
              return chain;
            },
          };
        }
        throw new Error(`tabela inesperada: ${tabela}`);
      },
      async rpc(...args: unknown[]) {
        eventos.push(args);
        return { error: null };
      },
    } as unknown as Admin;

    const base = {
      timestamp: 1_790_000_000,
      from: "554799999999@s.whatsapp.net",
      to: "554788888888@s.whatsapp.net",
      fromMe: false,
      id: row.external_id,
      hasMedia: true,
    };
    const waha = {
      async listChatMessages(
        _session: string,
        chatId: string,
        opts: { offset?: number; downloadMedia?: boolean } = {},
      ) {
        expect(chatId).toBe("554799999999@s.whatsapp.net");
        if (opts.downloadMedia) {
          return [{
            ...base,
            media: {
              url: "http://transport.local/media/db-index",
              mimetype: "audio/ogg",
            },
          }];
        }
        return [base];
      },
    } as unknown as WahaClient;

    const resultado = await hidratarMidiaHistoricaWahaPorBanco(
      admin,
      waha,
      {
        id: "canal",
        organization_id: "org",
        waha_session_name: "sessao",
      },
      { batchSize: 5, scanPageSize: 100 },
    );

    expect(resultado).toMatchObject({
      linhas_vistas: 1,
      midias_enfileiradas: 1,
      midias_indisponiveis: 0,
      completed: true,
    });
    expect(eventos).toHaveLength(1);
    expect(atualizacoes).toEqual([
      expect.objectContaining({
        media_url: "http://transport.local/media/db-index",
        media_mime: "audio/ogg",
      }),
    ]);
  });
});
