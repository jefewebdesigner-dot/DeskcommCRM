import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261003193000_0355_inbox_operacional.sql",
  "utf8",
);
const handler = readFileSync("app/api/v1/conversations/_handler.ts", "utf8");
const hook = readFileSync("hooks/inbox/useConversationsRealtime.ts", "utf8");

describe("categoria operacional do Inbox", () => {
  it("prioriza suporte e reconhece cliente pelo fato cadastral ou funil operacional", () => {
    const suporte = migration.indexOf("then 'support'");
    const cliente = migration.indexOf("then 'client'");
    expect(suporte).toBeGreaterThan(-1);
    expect(cliente).toBeGreaterThan(suporte);
    expect(migration).toContain("p.settings ->> 'operational_kind'");
    expect(migration).toContain("= 'support'");
    expect(migration).toContain("in ('post_sales','retention')");
    expect(migration).toContain("c.client_recognized_at is not null");
    expect(migration).toContain("cliente and p_demanda is not null");
  });

  it("mantém a projeção sincronizada quando contato, card ou funil mudam", () => {
    expect(migration).toContain("trg_inbox_category_on_contact");
    expect(migration).toContain("trg_inbox_category_on_lead");
    expect(migration).toContain("trg_inbox_category_on_pipeline");
    expect(migration).toContain(
      "before insert or update of organization_id, contact_id, current_demanda_id, inbox_category",
    );
  });

  it("filtra no banco antes da paginação, não no navegador", () => {
    expect(handler).toContain('query.eq("inbox_category", q.categoria)');
    expect(hook).toContain('qs.set("categoria", filters.categoria)');
  });
});
