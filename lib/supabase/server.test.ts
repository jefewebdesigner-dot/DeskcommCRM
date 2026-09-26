import { beforeEach, describe, expect, it, vi } from "vitest";

const neon = vi.hoisted(() => ({
  signIn: { email: vi.fn() },
  getSession: vi.fn(),
  token: vi.fn(),
}));
vi.mock("@/lib/neon/auth-server", () => ({ neonAuth: neon }));
vi.mock("@/lib/env", () => ({ env: { NEON_DATA_API_URL: "https://fixture.example.test" } }));
vi.mock("@neondatabase/neon-js", () => ({ createClient: vi.fn(() => ({})) }));

import { createClient } from "./server";

describe("login no adaptador Neon", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    neon.getSession.mockResolvedValue({ data: null, error: null });
  });

  it("retorna o usuário autenticado mesmo sem sessão legível na requisição atual", async () => {
    neon.signIn.email.mockResolvedValue({
      data: { user: { id: "fixture-user", email: "fixture@example.test", name: "Fixture" } },
      error: null,
    });
    const client = await createClient();
    const result = await client.auth.signInWithPassword({
      email: "fixture@example.test",
      password: "fixture-only",
    });
    expect(result.error).toBeNull();
    expect(result.data.user).toMatchObject({ id: "fixture-user", email: "fixture@example.test" });
    expect(neon.getSession).not.toHaveBeenCalled();
    expect(neon.token).not.toHaveBeenCalled();
  });

  it("preserva o erro do provedor sem retornar usuário", async () => {
    const error = { message: "Invalid credentials" };
    neon.signIn.email.mockResolvedValue({ data: null, error });
    const client = await createClient();
    const result = await client.auth.signInWithPassword({
      email: "fixture@example.test",
      password: "wrong",
    });
    expect(result.error).toEqual(error);
    expect(result.data.user).toBeNull();
    expect(neon.getSession).not.toHaveBeenCalled();
  });
});
