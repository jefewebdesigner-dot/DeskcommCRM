/** Cliente mínimo do REST do Neon Auth — sign-up/sign-in reais, sem forjar nada. */

function baseEOrigin() {
  const base = process.env.NEON_AUTH_BASE_URL;
  if (!base) throw new Error("NEON_AUTH_BASE_URL ausente");
  return { base: base.replace(/\/$/, ""), origin: new URL(base).origin };
}

function cookiePairs(headers: Headers): string {
  const extensao = headers as Headers & { getSetCookie?: () => string[] };
  const linhas = typeof extensao.getSetCookie === "function" ? extensao.getSetCookie() : [];
  return linhas
    .map((l) => l.split(";", 1)[0]?.trim())
    .filter((v): v is string => !!v)
    .join("; ");
}

export async function signUpEmail(email: string, password: string, name: string): Promise<string> {
  const { base, origin } = baseEOrigin();
  const r = await fetch(`${base}/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email, password, name }),
  });
  const body = (await r.json()) as { user?: { id: string } };
  if (!body.user?.id) throw new Error(`signup falhou para ${email}: HTTP ${r.status}`);
  return body.user.id;
}

/** Cookie de sessão bruto do Neon Auth — usado quando a chamada é direta na REST, não pela UI. */
export async function signInCookie(email: string, password: string): Promise<string> {
  const { base, origin } = baseEOrigin();
  const r = await fetch(`${base}/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`sign-in falhou HTTP ${r.status} para ${email}`);
  const cookie = cookiePairs(r.headers);
  if (!cookie) throw new Error(`sign-in sem cookie para ${email}`);
  return cookie;
}
