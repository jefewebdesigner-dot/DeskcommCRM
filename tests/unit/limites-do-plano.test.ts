import { describe, expect, it } from "vitest";

import { decidirLimite, limitesDaOrganizacao } from "@/lib/saas/limites-do-plano";

describe("limites do plano do Gravity CRM", () => {
  it("organização sem plano (PeríciaIA e anteriores) não tem limite", () => {
    expect(limitesDaOrganizacao({})).toEqual({ usuarios: null, whatsapp: null });
    expect(limitesDaOrganizacao(null)).toEqual({ usuarios: null, whatsapp: null });
  });

  it("standard = 2 usuários e 1 WhatsApp; enterprise sem limite", () => {
    expect(limitesDaOrganizacao({ plan: "standard" })).toEqual({ usuarios: 2, whatsapp: 1 });
    expect(limitesDaOrganizacao({ plan: "enterprise" })).toEqual({ usuarios: null, whatsapp: null });
  });

  it("settings.limites sobrescreve por organização; valor inválido mantém o do plano", () => {
    expect(limitesDaOrganizacao({ plan: "standard", limites: { usuarios: 5 } })).toEqual({ usuarios: 5, whatsapp: 1 });
    expect(limitesDaOrganizacao({ plan: "standard", limites: { whatsapp: null } })).toEqual({ usuarios: 2, whatsapp: null });
    expect(limitesDaOrganizacao({ plan: "standard", limites: { usuarios: -1, whatsapp: "x" } })).toEqual({ usuarios: 2, whatsapp: 1 });
  });

  it("bloqueia só quando passaria do limite, com mensagem clara", () => {
    const lim = { usuarios: 2, whatsapp: 1 };
    expect(decidirLimite(lim, "usuarios", 1)).toEqual({ ok: true });
    const r = decidirLimite(lim, "usuarios", 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensagem).toMatch(/2 usuários/);
    expect(decidirLimite(lim, "whatsapp", 1).ok).toBe(false);
    expect(decidirLimite(lim, "usuarios", 1, 2).ok).toBe(false); // convite em lote conta todos
    expect(decidirLimite({ usuarios: null, whatsapp: null }, "whatsapp", 99)).toEqual({ ok: true });
  });
});
