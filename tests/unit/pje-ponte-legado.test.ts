import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (...p: string[]) =>
  fs.readFileSync(path.join(process.cwd(), ...p), "utf8");

describe("PJe — ponte segura com o admin legado", () => {
  const ponte = read("lib", "pje", "legacy-admin.ts");
  const action = read("app", "actions", "admin", "updatePjeToken.ts");
  const configAction = read("app", "actions", "admin", "configurarPontePje.ts");
  const form = read("app", "admin", "(protected)", "pje", "_form.tsx");

  it("autentica no master-login e usa somente cookie em memória", () => {
    expect(ponte).toContain("/api/admin/master-login");
    expect(ponte).toContain("getSetCookie");
    expect(ponte).toContain("Cookie: cookie");
    expect(ponte).not.toContain("console.log");
    expect(ponte).not.toContain("console.error");
  });

  it("propaga o mesmo token para /api/admin/pje-token sem fallback inventado", () => {
    expect(ponte).toContain("/api/admin/pje-token");
    expect(ponte).toContain("JSON.stringify({ token })");
    expect(ponte).toContain('"payload_recusado"');
  });

  it("salvar token no CRM tenta propagar para o legado e informa o estado", () => {
    expect(action).toContain("propagarTokenPjeParaLegado(parsed.data.token)");
    expect(action).toContain(
      'sincronizacaoLegado: "ok" | "nao_configurada" | "falhou"',
    );
  });

  it("credenciais erradas são testadas antes de serem persistidas", () => {
    const teste = configAction.indexOf("verificarPontePje({");
    const salvar = configAction.indexOf("salvarCredenciaisPontePje(");
    expect(teste).toBeGreaterThan(-1);
    expect(salvar).toBeGreaterThan(teste);
  });

  it("UI deixa claro quando a ponte ainda não está conectada", () => {
    expect(form).toContain("Ponte com o PeríciaIA atual");
    expect(form).toContain("Conectar admin antigo");
    expect(form).toContain("Verificar conexão");
    expect(form).toContain("Token Ouro (Jus.br / PJe)");
  });
});
