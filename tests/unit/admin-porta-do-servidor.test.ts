import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { RPC_PELA_PORTA_DO_SERVIDOR, nomeDaRpcDoServidor } from "@/lib/supabase/admin";

describe("admin client — porta do servidor (neon 0045)", () => {
  it("troca só as funções que têm porta", () => {
    expect(nomeDaRpcDoServidor("fn_service_boundary")).toBe("fn_service_boundary_servidor");
    expect(nomeDaRpcDoServidor("fn_reply_delivery_policy")).toBe("fn_reply_delivery_policy_servidor");
    expect(nomeDaRpcDoServidor("emit_event")).toBe("emit_event");
    expect(nomeDaRpcDoServidor("fn_aplicar_quadro_do_onboarding")).toBe("fn_aplicar_quadro_do_onboarding");
  });
  it("cobre as 13 funções da migration 0045", () => {
    expect(RPC_PELA_PORTA_DO_SERVIDOR.size).toBe(13);
  });
});
