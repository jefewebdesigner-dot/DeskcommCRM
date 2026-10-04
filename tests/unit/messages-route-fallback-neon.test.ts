import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const rota = fs.readFileSync(
  path.join(process.cwd(), "app/api/v1/conversations/[id]/messages/route.ts"),
  "utf8",
);

describe("histórico do Inbox — fallback Neon sem ampliar acesso", () => {
  it("só usa cliente técnico depois de provar a conversa com a RLS do usuário", () => {
    const prova = rota.indexOf('.from("conversations")');
    const org = rota.indexOf('.eq("organization_id", activeOrg.orgId)', prova);
    const visivel = rota.indexOf("if (visibilityError || !visivel)", org);
    const tecnico = rota.indexOf("createAdminClient()", visivel);

    expect(prova).toBeGreaterThan(-1);
    expect(org).toBeGreaterThan(prova);
    expect(visivel).toBeGreaterThan(org);
    expect(tecnico).toBeGreaterThan(visivel);
  });

  it("o fallback só acontece para falha interna da leitura, nunca para 401/403/404", () => {
    expect(rota).toContain('err.code !== "internal_error"');
    expect(rota).toContain('return fail("not_found"');
  });

  it("registra request id e erro original para o próximo incidente ser diagnosticável", () => {
    expect(rota).toContain("[inbox.messages] leitura RLS falhou");
    expect(rota).toContain("request_id: requestId");
    expect(rota).toContain("data_api_error: err.message");
  });
});
