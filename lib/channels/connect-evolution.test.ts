import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { connectEvolutionChannel, reconnectEvolutionChannel } from "./connect-evolution";
import { EvolutionError } from "./evolution/client";

const ORG = "11111111-1111-4111-8111-111111111111";
const CANAL = "22222222-2222-4222-8222-222222222222";
const RECIBO = "33333333-3333-4333-8333-333333333333";
const LEASE = "44444444-4444-4444-8444-444444444444";
const CHAVE = "55555555-5555-4555-8555-555555555555";
const SEGREDO = "z".repeat(64);

const canal = (status = "STARTING") => ({
  id: CANAL,
  organization_id: ORG,
  evolution_instance_name: "evo_11111111_abcdef0123456789",
  webhook_path_token: "tokendowebhook0123456789",
  status,
});

function bancos(reserva: unknown, finish: (status: string) => unknown = (s) => canal(s)) {
  const authDb = { rpc: vi.fn().mockResolvedValue({ data: reserva, error: null }) };
  const serviceDb = {
    rpc: vi.fn().mockImplementation((_fn: string, args: { p_status: string }) =>
      Promise.resolve({ data: args.p_status === "remote_created" ? {} : finish(args.p_status), error: null }),
    ),
  };
  return { authDb, serviceDb };
}
const novaReserva = { replay: false, channel: canal(), receipt_id: RECIBO, lease_token: LEASE, webhook_secret: SEGREDO };
const entrada = { organizationId: ORG, idempotencyKey: CHAVE, userId: "u1", requestId: "r1", publicBaseUrl: "https://crm.test/" };

describe("connectEvolutionChannel", () => {
  it("cria a instância com o segredo no cabeçalho, fecha o recibo e devolve SCAN_QR_CODE", async () => {
    const { authDb, serviceDb } = bancos(novaReserva);
    const evo = {
      instanceInfo: vi.fn().mockRejectedValue(new EvolutionError("state", 404, true)),
      createInstance: vi.fn().mockResolvedValue({ instanceName: canal().evolution_instance_name, qr: { png: new Uint8Array([1]), pairingCode: null, count: 1 } }),
      setWebhook: vi.fn(),
      connect: vi.fn(),
    };
    const r = await connectEvolutionChannel(authDb as never, serviceDb as never, evo, entrada);
    expect(r.channel.status).toBe("SCAN_QR_CODE");
    const arg = evo.createInstance.mock.calls[0]![0];
    expect(arg.webhookUrl).toBe("https://crm.test/api/v1/webhooks/channel/tokendowebhook0123456789");
    expect(arg.webhookHeaders["x-gravity-webhook-secret"]).toBe(SEGREDO);
    const statuses = serviceDb.rpc.mock.calls.map((c) => (c[1] as { p_status: string }).p_status);
    expect(statuses).toEqual(["remote_created", "SCAN_QR_CODE"]);
  });

  it("o segredo nunca aparece no que a função devolve", async () => {
    const { authDb, serviceDb } = bancos(novaReserva);
    const evo = {
      instanceInfo: vi.fn().mockRejectedValue(new EvolutionError("state", 404, true)),
      createInstance: vi.fn().mockResolvedValue({ instanceName: canal().evolution_instance_name, qr: { png: null, pairingCode: null, count: null } }),
      setWebhook: vi.fn(),
      connect: vi.fn(),
    };
    const r = await connectEvolutionChannel(authDb as never, serviceDb as never, evo, entrada);
    expect(JSON.stringify(r)).not.toContain(SEGREDO);
  });

  it("retry com a instância já criada reaplica o webhook em vez de recriar", async () => {
    const { authDb, serviceDb } = bancos(novaReserva);
    const evo = {
      instanceInfo: vi.fn().mockResolvedValue({ state: "connecting", ownerJid: null, profileName: null, disconnectionReasonCode: null }),
      createInstance: vi.fn(),
      setWebhook: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue({ png: new Uint8Array([1]), pairingCode: null, count: 2 }),
    };
    const r = await connectEvolutionChannel(authDb as never, serviceDb as never, evo, entrada);
    expect(evo.createInstance).not.toHaveBeenCalled();
    expect(evo.setWebhook).toHaveBeenCalledTimes(1);
    expect(r.channel.status).toBe("SCAN_QR_CODE");
  });

  it("instância já conectada volta WORKING sem pedir QR", async () => {
    const { authDb, serviceDb } = bancos(novaReserva);
    const evo = {
      instanceInfo: vi.fn().mockResolvedValue({ state: "open", ownerJid: "5511@s.whatsapp.net", profileName: null, disconnectionReasonCode: null }),
      createInstance: vi.fn(),
      setWebhook: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn(),
    };
    const r = await connectEvolutionChannel(authDb as never, serviceDb as never, evo, entrada);
    expect(evo.connect).not.toHaveBeenCalled();
    expect(r.channel.status).toBe("WORKING");
  });

  it("falha no transporte fecha o recibo em FAILED e nunca apaga a instância", async () => {
    const { authDb, serviceDb } = bancos(novaReserva);
    const evo = {
      instanceInfo: vi.fn().mockRejectedValue(new EvolutionError("state", 404, true)),
      createInstance: vi.fn().mockRejectedValue(new EvolutionError("create", 502)),
      setWebhook: vi.fn(),
      connect: vi.fn(),
    };
    await expect(connectEvolutionChannel(authDb as never, serviceDb as never, evo, entrada)).rejects.toMatchObject({
      code: "connection_repair_required",
      status: 502,
      technical: { operation: "create", http_status: 502 },
    });
    expect(serviceDb.rpc.mock.calls.at(-1)?.[1]).toMatchObject({ p_status: "FAILED" });
  });

  it("replay devolve o canal sem tocar o transporte", async () => {
    const { authDb, serviceDb } = bancos({ replay: true, channel: canal("SCAN_QR_CODE"), receipt_id: RECIBO });
    const evo = { instanceInfo: vi.fn(), createInstance: vi.fn(), setWebhook: vi.fn(), connect: vi.fn() };
    const r = await connectEvolutionChannel(authDb as never, serviceDb as never, evo, entrada);
    expect(r.replay).toBe(true);
    expect(evo.instanceInfo).not.toHaveBeenCalled();
  });

  it("exige Idempotency-Key uuid e traduz erros da reserva", async () => {
    const { authDb, serviceDb } = bancos(novaReserva);
    const evo = { instanceInfo: vi.fn(), createInstance: vi.fn(), setWebhook: vi.fn(), connect: vi.fn() };
    await expect(
      connectEvolutionChannel(authDb as never, serviceDb as never, evo, { ...entrada, idempotencyKey: "" }),
    ).rejects.toMatchObject({ code: "idempotency_key_required", status: 422 });
    authDb.rpc.mockResolvedValueOnce({ data: null, error: { message: "connection_forbidden", code: "42501" } });
    await expect(connectEvolutionChannel(authDb as never, serviceDb as never, evo, entrada)).rejects.toMatchObject({
      code: "connection_forbidden",
      status: 403,
    });
  });

  it("recusa recibo de outra organização", async () => {
    const { authDb, serviceDb } = bancos({ ...novaReserva, channel: { ...canal(), organization_id: "99999999-9999-4999-8999-999999999999" } });
    const evo = { instanceInfo: vi.fn(), createInstance: vi.fn(), setWebhook: vi.fn(), connect: vi.fn() };
    await expect(connectEvolutionChannel(authDb as never, serviceDb as never, evo, entrada)).rejects.toMatchObject({
      code: "connection_reservation_missing",
    });
    expect(evo.createInstance).not.toHaveBeenCalled();
  });
});

describe("reconnectEvolutionChannel", () => {
  const info = (state: string) => ({ state, ownerJid: null, profileName: null, disconnectionReasonCode: null });

  it("suave: já conectada não mexe em nada", async () => {
    const evo = { instanceInfo: vi.fn().mockResolvedValue(info("open")), connect: vi.fn(), logout: vi.fn() };
    expect(await reconnectEvolutionChannel(evo, "evo_x", false)).toBe("WORKING");
    expect(evo.connect).not.toHaveBeenCalled();
    expect(evo.logout).not.toHaveBeenCalled();
  });

  it("suave: desconectada pede QR novo sem deslogar", async () => {
    const evo = {
      instanceInfo: vi.fn().mockResolvedValue(info("close")),
      connect: vi.fn().mockResolvedValue({ png: new Uint8Array([1]), pairingCode: null, count: 1 }),
      logout: vi.fn(),
    };
    expect(await reconnectEvolutionChannel(evo, "evo_x", false)).toBe("SCAN_QR_CODE");
    expect(evo.logout).not.toHaveBeenCalled();
  });

  it("force: desloga (tolerando 4xx) e recomeça o pareamento", async () => {
    const evo = {
      instanceInfo: vi.fn().mockResolvedValue(info("open")),
      connect: vi.fn().mockResolvedValue({ png: new Uint8Array([1]), pairingCode: null, count: 1 }),
      logout: vi.fn().mockRejectedValue(new EvolutionError("logout", 400)),
    };
    expect(await reconnectEvolutionChannel(evo, "evo_x", true)).toBe("SCAN_QR_CODE");
    expect(evo.logout).toHaveBeenCalledTimes(1);
  });

  it("force: falha de servidor no logout NÃO segue adiante", async () => {
    const evo = {
      instanceInfo: vi.fn().mockResolvedValue(info("open")),
      connect: vi.fn(),
      logout: vi.fn().mockRejectedValue(new EvolutionError("logout", 500)),
    };
    await expect(reconnectEvolutionChannel(evo, "evo_x", true)).rejects.toBeInstanceOf(EvolutionError);
    expect(evo.connect).not.toHaveBeenCalled();
  });
});
