import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), "utf8");

describe("PJe global — passo 1", () => {
  it("possui uma única porta server-only que resolve a credencial global", () => {
    const cfg = read("lib", "pje", "config.ts");
    expect(cfg).toContain('import "server-only"');
    expect(cfg).toContain('valorDaInstalacao("PJE_GLOBAL_TOKEN")');
    expect(cfg).toContain("estadoParaTela(CHAVE_TOKEN_PJE, true)");
    expect(cfg).toContain("ehSegredo: true");
  });

  it("a tela nunca lê nem recebe o plaintext do token", () => {
    const page = read("app", "admin", "(protected)", "pje", "page.tsx");
    const form = read("app", "admin", "(protected)", "pje", "_form.tsx");
    expect(page).toContain("estadoTokenPje()");
    expect(page).not.toContain("tokenPjeGlobal()");
    expect(form).toContain('type="password"');
    expect(form).toContain("last4Inicial");
  });

  it("só platform admin grava e auditoria nunca recebe o token", () => {
    const action = read("app", "actions", "admin", "updatePjeToken.ts");
    expect(action).toContain("requirePlatformAdmin()");
    expect(action).toContain("salvarTokenPje(parsed.data.token, user.id)");
    expect(action).toContain('action: "platform.config_changed"');
    expect(action).toContain("last4: parsed.data.token.slice(-4)");
    expect(action).not.toContain("metadata: { token");
  });

  it("fica acessível pela navegação administrativa", () => {
    const sidebar = read("components", "admin", "AdminSidebar.tsx");
    expect(sidebar).toContain('{ href: "/admin/pje", label: "PJe"');
  });
});
