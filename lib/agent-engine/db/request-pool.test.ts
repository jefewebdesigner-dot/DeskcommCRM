import { beforeEach, describe, expect, it, vi } from "vitest";

const { createPool, on, query, release } = vi.hoisted(() => {
  const query = vi.fn(async () => ({ rows: [] }));
  const release = vi.fn();
  const on = vi.fn((event: string, cb: (client: { query: typeof query; release: typeof release }) => void) => {
    if (event === "connect") cb({ query, release });
  });
  return {
    createPool: vi.fn((databaseUrl: string) => ({ databaseUrl, on }) as never),
    on,
    query,
    release,
  };
});

vi.mock("./pool", () => ({ createPool }));

import { createRequestPoolForUser } from "./request-pool";

const USER = "11111111-1111-4111-8111-111111111111";

describe("createRequestPoolForUser", () => {
  beforeEach(() => {
    createPool.mockClear();
    on.mockClear();
    query.mockClear();
    release.mockClear();
    query.mockResolvedValue({ rows: [] });
    delete process.env.SUPABASE_DB_URL;
    process.env.DATABASE_URL =
      "postgresql://app:secret@example-pooler.neon.tech/neondb?sslmode=require";
  });

  it("usa endpoint direto e injeta o claim do Neon Auth em cada conexão", async () => {
    createRequestPoolForUser(USER);
    await vi.waitFor(() => expect(query).toHaveBeenCalled());

    expect(createPool).toHaveBeenCalledTimes(1);
    const url = new URL(String(createPool.mock.calls[0]?.[0]));
    expect(url.hostname).toBe("example.neon.tech");
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(on).toHaveBeenCalledWith("connect", expect.any(Function));
    expect(query).toHaveBeenCalledWith(
      "select set_config('request.jwt.claim.sub', $1, false)",
      [USER],
    );
  });

  it("preserva options já existentes na connection string", () => {
    process.env.DATABASE_URL =
      "postgresql://app:secret@example-pooler.neon.tech/neondb?sslmode=require&options=-c%20statement_timeout%3D5000";

    createRequestPoolForUser(USER);

    const url = new URL(String(createPool.mock.calls[0]?.[0]));
    expect(url.searchParams.get("options")).toBe("-c statement_timeout=5000");
  });

  it("recusa identidade que não seja UUID antes de abrir conexão", () => {
    expect(() => createRequestPoolForUser("usuario-do-body")).toThrow(
      "user_id inválido",
    );
    expect(createPool).not.toHaveBeenCalled();
  });
});
