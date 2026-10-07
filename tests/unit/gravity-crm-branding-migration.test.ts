import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root=process.cwd();
const migration=fs.readFileSync(
  path.join(root,"neon/migrations/20261007_0042_gravity_crm_default_branding.sql"),
  "utf8",
);
const installer=fs.readFileSync(
  path.join(root,"hostgator-setup-kit/install.sh"),
  "utf8",
);

describe("Gravity CRM default branding migration",()=>{
  it("novas instalações oferecem Gravity CRM como padrão visível",()=>{
    expect(installer).toContain(
      "APP_NAME|Nome que aparece na interface (Enter para o padrão)|Gravity CRM",
    );
  });

  it("só converte a marca legada quando ela veio de semeadura automática",()=>{
    expect(migration).toMatch(/set app_name='Gravity CRM'[\s\S]*seeded_from_env=true/i);
    expect(migration).toMatch(/deskcommcrm/i);
  });

  it("não contém update genérico capaz de sobrescrever white-label humano",()=>{
    const update=migration.match(/update public\.platform_branding[\s\S]*?;/i)?.[0] ?? "";
    expect(update).toContain("seeded_from_env=true");
    expect(update).toContain("where id=1");
  });
});
