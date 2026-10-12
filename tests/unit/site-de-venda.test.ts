import { describe, expect, it } from "vitest";
import { hostDoSiteDeVenda } from "@/lib/site-de-venda";

describe("site de venda só nos domínios de venda", () => {
  it("sem lista configurada, nenhum domínio mostra o site (o painel continua na raiz)", () => {
    expect(hostDoSiteDeVenda("periciaia.vercel.app", "")).toBe(false);
    expect(hostDoSiteDeVenda("periciaia.vercel.app", undefined)).toBe(false);
  });

  it("casa o domínio exato, ignorando porta, caixa e esquema escrito na lista", () => {
    const lista = " https://GravityCRM.com.br/ , www.gravitycrm.com.br";
    expect(hostDoSiteDeVenda("gravitycrm.com.br", lista)).toBe(true);
    expect(hostDoSiteDeVenda("WWW.gravitycrm.com.br:443", lista)).toBe(true);
    expect(hostDoSiteDeVenda("periciaia.vercel.app", lista)).toBe(false);
  });

  it("não casa subdomínio nem domínio que só termina igual", () => {
    expect(hostDoSiteDeVenda("app.gravitycrm.com.br", "gravitycrm.com.br")).toBe(false);
    expect(hostDoSiteDeVenda("falsogravitycrm.com.br", "gravitycrm.com.br")).toBe(false);
    expect(hostDoSiteDeVenda("", "gravitycrm.com.br")).toBe(false);
  });
});
