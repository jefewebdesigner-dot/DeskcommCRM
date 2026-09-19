import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  enabled: true,
  verify: vi.fn(),
  apply: vi.fn(),
}));

vi.mock("@/lib/tenants/provisioning-capability", () => ({
  tenantProvisioningEnabled: () => h.enabled,
  verifyBlueprintCapability: h.verify,
}));
vi.mock("@/lib/tenants/apply-blueprint", () => ({ applySalesTwinBlueprint: h.apply }));

const { POST } = await import("./route");

const BLUEPRINT = {
  sales_twin_version: 1,
  deployment_id: "dep-42",
  organization: {
    name: "Clínica Teste",
    segment: "Clínica",
    summary: "Resumo",
    audience: [],
    location: "",
  },
  offer: { primary: "Avaliação", services: ["Serviço"], conversion_goal: "Agendar" },
  pipeline: {
    pipeline_name: "Comercial",
    stages: ["Novo lead", "Qualificado", "Fechado"],
    lead_fields: [{ key: "interesse", label: "Interesse", type: "text", required: false }],
    tags: [],
  },
  agent: {
    name: "Consultor IA",
    objective: "Qualificar e agendar",
    tone: "Consultivo",
    qualification_questions: ["Qual seu objetivo?"],
    handoff_rules: ["Pedido de humano"],
    forbidden_claims: ["Não inventar preço"],
  },
  automations: [],
  tracking: { events: ["lead_submitted"], utm_required: true },
  knowledge: { known_facts: ["Fato"], required_sources: [], missing_facts: ["Preço"] },
  generated_at: null,
};

function pedido(token: string | null, body: unknown = BLUEPRINT) {
  return new NextRequest("http://localhost/api/v1/tenants/provision-blueprint", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.enabled = true;
  h.verify.mockReturnValue({
    v: 1,
    scope: "tenant:blueprint",
    organization_id: "org-1",
    integration: "zheus-sales-twin",
    external_id: "dep-42",
    iat: 1,
    exp: 9999999999,
    jti: "x",
  });
  h.apply.mockResolvedValue({
    organization_id: "org-1",
    deployment_id: "dep-42",
    replay: false,
    warnings: [],
  });
});

describe("POST /tenants/provision-blueprint", () => {
  it("rota não existe enquanto provisionamento está desligado", async () => {
    h.enabled = false;
    expect((await POST(pedido("qualquer"))).status).toBe(404);
    expect(h.apply).not.toHaveBeenCalled();
  });

  it("recusa capability ausente/inválida", async () => {
    h.verify.mockReturnValue(null);
    expect((await POST(pedido(null))).status).toBe(401);
    expect(h.apply).not.toHaveBeenCalled();
  });

  it("recusa deployment de outra capability", async () => {
    const res = await POST(pedido("cap", { ...BLUEPRINT, deployment_id: "dep-outro" }));
    expect(res.status).toBe(403);
    expect(h.apply).not.toHaveBeenCalled();
  });

  it("valida o corpo antes de aplicar", async () => {
    const res = await POST(
      pedido("cap", { ...BLUEPRINT, pipeline: { ...BLUEPRINT.pipeline, stages: ["Só uma"] } }),
    );
    expect(res.status).toBe(422);
    expect(h.apply).not.toHaveBeenCalled();
  });

  it("aplica somente na organização codificada na capability", async () => {
    const res = await POST(pedido("cap"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(h.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        integration: "zheus-sales-twin",
        externalId: "dep-42",
        blueprint: expect.objectContaining({ deployment_id: "dep-42" }),
      }),
    );
  });
});
