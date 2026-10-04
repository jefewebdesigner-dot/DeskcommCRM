import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const login = fs.readFileSync(
  path.join(process.cwd(), "app/(public)/login/page.tsx"),
  "utf8",
);

describe("login interno do PeríciaIA", () => {
  it("não oferece criação pública de conta", () => {
    expect(login).not.toContain('href="/signup"');
    expect(login).not.toContain('{t("Criar conta")}');
    expect(login).toContain("Novas contas não são abertas ao público");
  });

  it("mantém recuperação de senha", () => {
    expect(login).toContain('href="/login/forgot"');
  });
});
