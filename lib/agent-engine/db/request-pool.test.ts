import { beforeEach, describe, expect, it, vi } from "vitest";

const { createPool } = vi.hoisted(() => ({
  createPool: vi.fn((databaseUrl: string) => ({ databaseUrl }) as never),
}));

vi.mock("./pool", () => ({ createPool }));

import { createRequestPoolForUser } from "./request-pool";

const USER = "11111111-1111-4111-8111-111111111111";

describe("createRequestPoolForUser", () => {
  beforeEach(() => {
    createPool.mockClear();
    delete process.env.SUPABASE_DB_URL;
    process.env.DATABASE_URL =
      "postgresql://app:secret@example.neon.tech/neondb?sslmode=require";
  });

  it("preserva a connection string e injeta somente o app.user_id", () => {
    createRequestPoolForUser(USER);

    expect(createPool).toHaveBeenCalledTimes(1);
    const url = new URL(String(createPool.mock.calls[0]?.[0]));
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.get("options")).toBe(`-c app.user_id=${USER}`);
  });

  it("preserva options já existentes ao adicionar a identidade", () => {
    process.env.DATABASE_URL =
      "postgresql://app:secret@example.neon.tech/neondb?sslmode=require&options=-c%20statement_timeout%3D5000";

    createRequestPoolForUser(USER);

    const url = new URL(String(createPool.mock.calls[0]?.[0]));
    expect(url.searchParams.get("options")).toBe(
      `-c statement_timeout=5000 -c app.user_id=${USER}`,
    );
  });

  it("recusa identidade que não seja UUID antes de abrir conexão", () => {
    expect(() => createRequestPoolForUser("usuario-do-body")).toThrow(
      "user_id inválido",
    );
    expect(createPool).not.toHaveBeenCalled();
  });
});
