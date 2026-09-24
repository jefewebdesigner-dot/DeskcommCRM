import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("a atualizacao ao vivo nao depende de publicacao Supabase", () => {
  it("o hook compartilhado nao assina postgres_changes", () => {
    const fonte = readFileSync(
      "hooks/realtime/useRealtimeChannel.ts",
      "utf8",
    );
    expect(fonte).not.toMatch(/postgres_changes/);
    expect(fonte).not.toMatch(/supabase_realtime/);
    expect(fonte).not.toMatch(/\.channel\(/);
  });

  it("a reconciliacao usa consultas normais protegidas por Auth/RLS", () => {
    const fonte = readFileSync(
      "hooks/realtime/useRealtimeChannel.ts",
      "utf8",
    );
    expect(fonte).toMatch(/prepareRealtimeAuthentication/);
    expect(fonte).toMatch(/neon-poll/);
    expect(fonte).toMatch(/setInterval\(reconciliar, POLLING_MS\)/);
  });
});
