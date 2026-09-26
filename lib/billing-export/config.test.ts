// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: { NEON_AUTH_COOKIE_SECRET: "a".repeat(32), DATABASE_URL: "postgresql://invalid.invalid" },
  query: vi.fn(),
  release: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: mocks.env }));
vi.mock("pg", () => ({
  Pool: class {
    on() {}
    async connect() {
      return { query: mocks.query, release: mocks.release };
    }
  },
}));

import {
  decryptToken,
  encryptToken,
  readConnection,
  removeConnection,
  saveConnection,
} from "./config";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const token = "synthetic-test-bearer";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockReset();
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.env.NEON_AUTH_COOKIE_SECRET = "a".repeat(32);
});

describe("tenant-bound credential encryption", () => {
  it("roundtrips with random IV, without plaintext in persisted envelope", () => {
    const first = encryptToken(A, token);
    expect(first).not.toContain(token);
    expect(encryptToken(A, token)).not.toBe(first);
    expect(decryptToken(A, first)).toBe(token);
  });
  it("rejects moving ciphertext into a different tenant", () => {
    expect(() => decryptToken(B, encryptToken(A, token))).toThrow("Reconecte");
  });
  it("rejects altered ciphertext and authentication tag", () => {
    const parts = encryptToken(A, token).split(".");
    for (const index of [2, 3]) {
      const altered = [...parts];
      const bytes = Buffer.from(altered[index]!, "base64url");
      bytes[0] = bytes[0]! ^ 1;
      altered[index] = bytes.toString("base64url");
      expect(() => decryptToken(A, altered.join("."))).toThrow("Reconecte");
    }
  });
  it("rejects key rotation until reconnection", () => {
    const envelope = encryptToken(A, token);
    mocks.env.NEON_AUTH_COOKIE_SECRET = "b".repeat(32);
    expect(() => decryptToken(A, envelope)).toThrow("Reconecte");
  });
  it.each(["v2.invalid", "v1.a.b.c", "v1....", "plaintext"])(
    "rejects malformed envelope %s",
    (value) => {
      expect(() => decryptToken(A, value)).toThrow("Reconecte");
    },
  );
});

describe("connection repository", () => {
  it("reads with tenant filter and transaction-local scope, then commits", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("to_regclass")) return { rows: [{ installed: true }] };
      if (sql.startsWith("select encrypted_token"))
        return {
          rows: [
            {
              encrypted_token: encryptToken(A, token),
              updated_at: new Date("2026-09-25T12:00:00Z"),
            },
          ],
        };
      return { rows: [] };
    });
    expect(await readConnection(A)).toEqual({ token, updated_at: "2026-09-25T12:00:00.000Z" });
    expect(mocks.query).toHaveBeenCalledWith(
      "select set_config('app.billing_export_org', $1, true)",
      [A],
    );
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("where organization_id = $1"),
      [A],
    );
    expect(mocks.query).toHaveBeenCalledWith("COMMIT");
    expect(mocks.release).toHaveBeenCalledWith(false);
  });
  it("missing module is disconnected, not a database failure", async () => {
    expect(await readConnection(A)).toBeNull();
    mocks.query.mockRejectedValue(new Error("private-db-error"));
    await expect(readConnection(A)).rejects.toThrow("Não foi possível acessar");
    expect(mocks.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.release).toHaveBeenLastCalledWith(true);
  });
  it("persists tenant-bound ciphertext only", async () => {
    await saveConnection(A, token);
    const insert = mocks.query.mock.calls.find(([sql]) => String(sql).startsWith("insert into"));
    expect(insert).toBeDefined();
    expect(insert![1][0]).toBe(A);
    expect(insert![1][1]).not.toContain(token);
    expect(decryptToken(A, insert![1][1])).toBe(token);
  });
  it("deletes only requested tenant and rolls back after failed query", async () => {
    await removeConnection(A);
    expect(mocks.query).toHaveBeenCalledWith(
      "delete from public.billing_export_connections where organization_id = $1",
      [A],
    );
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("delete")) throw new Error("private");
      return { rows: [] };
    });
    await expect(removeConnection(B)).rejects.toThrow("Não foi possível acessar");
    expect(mocks.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.release).toHaveBeenLastCalledWith(false);
  });
});
