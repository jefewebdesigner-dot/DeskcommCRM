import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { patchConversationHandler } from "@/app/api/v1/conversations/_handler";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/app/api/v1/conversations/_handler", () => ({
  patchConversationHandler: vi.fn(),
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({
  requireSupportWrite: vi.fn(async () => null),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const ORG = "9563e071-406b-4db2-aaa4-d08846d3267b";
const USER = "11111111-1111-4111-8111-111111111111";
const CONVERSA = "1266754f-0267-4eea-939a-50dbd497697c";
const fakeClient = { from: vi.fn() };

function pedido(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/conversations/" + CONVERSA + "/close", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
  vi.mocked(createClient).mockResolvedValue(fakeClient as never);
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: {
      id: USER,
      email: "agente@example.com",
      full_name: "Agente",
      avatar_url: null,
      is_platform_admin: false,
      idioma: "pt-BR",
      organizations: [{ organization_id: ORG, organization_name: "PeríciaIA", role: "agent" }],
    },
    org: { orgId: ORG, name: "PeríciaIA", role: "agent" },
  } as never);
  vi.mocked(patchConversationHandler).mockResolvedValue({
    id: CONVERSA,
    organization_id: ORG,
    status: "closed",
    service_revision: 2,
  } as never);
});

describe("fechar conversa", () => {
  it("delega ao handler canônico de status e relê a conversa por esse caminho", async () => {
    const { POST } = await import("@/app/api/v1/conversations/[id]/close/route");
    const res = await POST(pedido({ expected_revision: 1 }), {
      params: Promise.resolve({ id: CONVERSA }),
    });

    expect(res.status).toBe(200);
    expect(patchConversationHandler).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({
        organization_id: ORG,
        actor: { type: "user", id: USER },
      }),
      CONVERSA,
      { status: "closed", expected_revision: 1 },
    );
  });

  it("revisão inválida morre antes de tocar handler ou banco", async () => {
    const { POST } = await import("@/app/api/v1/conversations/[id]/close/route");
    const res = await POST(pedido({ expected_revision: 0 }), {
      params: Promise.resolve({ id: CONVERSA }),
    });

    expect(res.status).toBe(422);
    expect(patchConversationHandler).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("o botão do Inbox usa o PATCH canônico, não a rota legada duplicada", () => {
    const fonte = readFileSync("hooks/inbox/useCloseConversation.ts", "utf8");
    expect(fonte).toContain("apiClient.patch");
    expect(fonte).toContain('status: "closed"');
    expect(fonte).toContain("expected_revision: args.expected_revision");
    expect(fonte).not.toContain("/close");
  });
});
