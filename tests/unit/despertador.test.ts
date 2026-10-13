import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ESPERA_EM_ALERTA_MS,
  JANELA_DE_ALERTA_MS,
  _reiniciarDespertador,
  acordar,
  aguardar,
  emAlerta,
  esperaEfetiva,
} from "@/lib/agent-engine/despertador";
import { CHAVE_DO_DESPERTADOR, lerAviso } from "@/lib/agent-engine/despertador-redis";
import { avisarWorker, deveAvisar } from "@/lib/despertar-worker";

afterEach(() => {
  _reiniciarDespertador();
  vi.useRealTimers();
});

describe("despertador do worker (Neon grátis: banco dorme quando não há trabalho)", () => {
  it("fora do alerta vale o intervalo ocioso inteiro; em alerta, no máximo poucos segundos", () => {
    const t0 = 1_000_000;
    expect(emAlerta(t0)).toBe(false);
    expect(esperaEfetiva(900_000, t0)).toBe(900_000);
    acordar(t0);
    expect(emAlerta(t0 + 1)).toBe(true);
    expect(esperaEfetiva(900_000, t0 + 1)).toBe(ESPERA_EM_ALERTA_MS);
    expect(esperaEfetiva(1_000, t0 + 1)).toBe(1_000);
    expect(emAlerta(t0 + JANELA_DE_ALERTA_MS + 1)).toBe(false);
  });

  it("aguardar volta na hora quando chega um aviso", async () => {
    vi.useFakeTimers();
    let voltou = false;
    const p = aguardar(15 * 60_000).then(() => { voltou = true; });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(voltou).toBe(false);
    acordar();
    await p;
    expect(voltou).toBe(true);
  });

  it("aguardar respeita o abort (desligamento) e nunca rejeita", async () => {
    const ac = new AbortController();
    const p = aguardar(60_000, ac.signal);
    ac.abort();
    await expect(p).resolves.toBeUndefined();
  });
});

describe("aviso pelo Redis", () => {
  it("o CRM só avisa em requisições que mudam algo", () => {
    expect(deveAvisar("POST")).toBe(true);
    expect(deveAvisar("patch")).toBe(true);
    expect(deveAvisar("GET")).toBe(false);
    expect(deveAvisar("OPTIONS")).toBe(false);
  });

  it("avisarWorker faz INCR na chave do despertador e não faz nada sem Redis configurado", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: 1 })));
    await avisarWorker({ UPSTASH_REDIS_REST_URL: "https://kv.exemplo.dev/", UPSTASH_REDIS_REST_TOKEN: "t" }, f as never);
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual(["INCR", CHAVE_DO_DESPERTADOR]);
    f.mockClear();
    await avisarWorker({}, f as never);
    expect(f).not.toHaveBeenCalled();
  });

  it("avisarWorker nunca lança, mesmo com o Redis fora", async () => {
    const f = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(avisarWorker({ UPSTASH_REDIS_REST_URL: "https://kv.exemplo.dev", UPSTASH_REDIS_REST_TOKEN: "t" }, f as never)).resolves.toBeUndefined();
  });

  it("o worker zera o contador (GETSET) e só acorda se havia aviso", async () => {
    const com = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: "3" })));
    expect(await lerAviso({ url: "https://kv.exemplo.dev", token: "t", fetchImpl: com as never })).toBe(true);
    expect(JSON.parse(com.mock.calls[0][1].body)).toEqual(["GETSET", CHAVE_DO_DESPERTADOR, "0"]);
    const sem = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: "0" })));
    expect(await lerAviso({ url: "https://kv.exemplo.dev", token: "t", fetchImpl: sem as never })).toBe(false);
    const nulo = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: null })));
    expect(await lerAviso({ url: "https://kv.exemplo.dev", token: "t", fetchImpl: nulo as never })).toBe(false);
  });
});
