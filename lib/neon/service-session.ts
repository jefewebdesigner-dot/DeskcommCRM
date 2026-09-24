import "server-only";

import { env } from "@/lib/env";

type ServiceSession = {
  cookie: string;
  token: string;
  expiresAt: number;
};

let cached: ServiceSession | null = null;
let inFlight: Promise<ServiceSession> | null = null;

function authUrl(path: string): string {
  return `${env.NEON_AUTH_BASE_URL.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function cookiePairs(headers: Headers): string {
  const extensao = headers as Headers & { getSetCookie?: () => string[] };
  const linhas =
    typeof extensao.getSetCookie === "function"
      ? extensao.getSetCookie()
      : (headers.get("set-cookie") ?? "")
          .split(/,(?=[^;,]+=)/g)
          .filter(Boolean);
  return linhas
    .map((linha) => linha.split(";", 1)[0]?.trim())
    .filter((v): v is string => !!v)
    .join("; ");
}

function expiraEm(token: string): number {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { exp?: number };
    if (typeof payload.exp === "number") return payload.exp * 1000;
  } catch {}
  return Date.now() + 5 * 60_000;
}

async function abrirSessao(): Promise<ServiceSession> {
  const origin = new URL(env.NEON_AUTH_BASE_URL).origin;
  const login = await fetch(authUrl("sign-in/email"), {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      email: env.NEON_SERVICE_EMAIL,
      password: env.NEON_SERVICE_PASSWORD,
    }),
    cache: "no-store",
  });
  if (!login.ok) {
    throw new Error(`Neon Auth service login falhou: HTTP ${login.status}`);
  }

  const cookie = cookiePairs(login.headers);
  if (!cookie) throw new Error("Neon Auth não devolveu cookie para a identidade técnica.");

  const tokenRes = await fetch(authUrl("token"), {
    method: "GET",
    headers: { cookie, origin },
    cache: "no-store",
  });
  if (!tokenRes.ok) {
    throw new Error(`Neon Auth service token falhou: HTTP ${tokenRes.status}`);
  }
  const body = (await tokenRes.json()) as { token?: string };
  if (!body.token) throw new Error("Neon Auth não devolveu JWT para a identidade técnica.");

  return { cookie, token: body.token, expiresAt: expiraEm(body.token) };
}

export async function serviceSession(): Promise<ServiceSession> {
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached;
  inFlight ??= abrirSessao().finally(() => {
    inFlight = null;
  });
  cached = await inFlight;
  return cached;
}

export async function serviceJwt(): Promise<string> {
  return (await serviceSession()).token;
}

export async function serviceAuthRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const session = await serviceSession();
  const headers = new Headers(init.headers);
  headers.set("cookie", session.cookie);
  headers.set("origin", new URL(env.NEON_AUTH_BASE_URL).origin);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  let response = await fetch(authUrl(path), {
    ...init,
    headers,
    cache: "no-store",
  });

  if (response.status === 401) {
    cached = null;
    const renovada = await serviceSession();
    headers.set("cookie", renovada.cookie);
    response = await fetch(authUrl(path), {
      ...init,
      headers,
      cache: "no-store",
    });
  }
  return response;
}

export function resetServiceSessionForTests(): void {
  cached = null;
  inFlight = null;
}
