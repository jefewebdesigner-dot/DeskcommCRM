import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const rota = fs.readFileSync(
  path.join(process.cwd(), "app/api/v1/conversations/[id]/messages/route.ts"),
  "utf8",
);

describe("histórico do Inbox — autorização separada da leitura técnica", () => {
  it("prova a conversa com a RLS do usuário antes de criar o cliente técnico", () => {
    const prova = rota.indexOf('.from("conversations")');
    const id = rota.indexOf('.eq("id", conversationId)', prova);
    const org = rota.indexOf('.eq("organization_id", activeOrg.orgId)', id);
    const autorizado = rota.indexOf("if (!visivel)", org);
    const tecnico = rota.indexOf("createAdminClient()", autorizado);

    expect(prova).toBeGreaterThan(-1);
    expect(id).toBeGreaterThan(prova);
    expect(org).toBeGreaterThan(id);
    expect(autorizado).toBeGreaterThan(org);
    expect(tecnico).toBeGreaterThan(autorizado);
  });

  it("não consulta messages com a identidade do usuário antes da prova de acesso", () => {
    const prova = rota.indexOf('.from("conversations")');
    const handler = rota.indexOf("listMessagesHandler(", prova);
    const tecnico = rota.indexOf("createAdminClient()", handler);

    expect(prova).toBeGreaterThan(-1);
    expect(handler).toBeGreaterThan(prova);
    expect(tecnico).toBeGreaterThan(handler);
    expect(rota.slice(0, handler)).not.toContain("listMessagesHandler(\n        supabase");
  });

  it("nega conversa invisível e não transforma falha de autorização em bypass", () => {
    expect(rota).toContain('return fail("not_found"');
    expect(rota).toContain("if (visibilityError)");
    expect(rota).toContain("não foi possível provar visibilidade da conversa");
  });

  it("mantém organization_id + conversation_id no contexto da leitura", () => {
    expect(rota).toContain("organization_id: activeOrg.orgId");
    expect(rota).toContain("conversationId,");
  });
});
