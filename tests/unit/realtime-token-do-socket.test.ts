import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function soCodigo(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("Neon substitui o socket Supabase", () => {
  it("o browser usa o SDK Neon com SupabaseAuthAdapter", () => {
    const fonte = soCodigo(readFileSync("lib/supabase/browser.ts", "utf8"));
    expect(fonte).toMatch(/@neondatabase\/neon-js/);
    expect(fonte).toMatch(/SupabaseAuthAdapter/);
    expect(fonte).toMatch(/NEON_AUTH_BASE_URL/);
    expect(fonte).toMatch(/NEON_DATA_API_URL/);
    expect(fonte).not.toMatch(/NEXT_PUBLIC_SUPABASE/);
    expect(fonte).not.toMatch(/realtime\.setAuth/);
  });

  it("o hook nao abre socket nem busca token paralelo", () => {
    const fonte = soCodigo(
      readFileSync("hooks/realtime/useRealtimeChannel.ts", "utf8"),
    );
    expect(fonte).not.toMatch(/\.channel\(/);
    expect(fonte).not.toMatch(/postgres_changes/);
    expect(fonte).not.toMatch(/setAuth/);
    expect(fonte).toMatch(/prepareRealtimeAuthentication/);
  });
});