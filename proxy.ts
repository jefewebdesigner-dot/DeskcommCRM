import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { isPublicPath } from "@/lib/auth/public-paths";
import { neonAuth } from "@/lib/neon/auth-server";
import {
  verifyImpersonateCookieEdge,
  IMPERSONATE_COOKIE_NAME_EDGE,
} from "@/lib/impersonate/cookie-edge";

function cookieHeader(request: NextRequest): string {
  return request.cookies
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
}

async function jwtNeon(request: NextRequest): Promise<string | null> {
  const res = await fetch(
    `${env.NEON_AUTH_BASE_URL.replace(/\/$/, "")}/token`,
    {
      method: "GET",
      headers: {
        cookie: cookieHeader(request),
        origin: new URL(request.url).origin,
      },
      cache: "no-store",
    },
  );
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { token?: string } | null;
  return data?.token ?? null;
}

async function ehPlatformAdmin(request: NextRequest): Promise<boolean> {
  const token = await jwtNeon(request);
  if (!token) return false;
  const res = await fetch(
    `${env.NEON_DATA_API_URL.replace(/\/$/, "")}/rpc/fn_is_platform_admin`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: "{}",
      cache: "no-store",
    },
  );
  if (!res.ok) return false;
  return (await res.json().catch(() => false)) === true;
}

function copiarCookiesDeAuth(origem: NextResponse, destino: NextResponse) {
  const headers = origem.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = headers.getSetCookie?.() ?? [];
  if (cookies.length > 0) {
    for (const cookie of cookies) destino.headers.append("set-cookie", cookie);
    return;
  }
  const combinado = origem.headers.get("set-cookie");
  if (combinado) destino.headers.append("set-cookie", combinado);
}

export async function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const { pathname, search } = request.nextUrl;
  request.headers.set("x-pathname", pathname);

  const host = request.headers.get("host") ?? "";
  const isAdminSurface =
    host.startsWith("admin.") || pathname.startsWith("/admin");

  if (isPublicPath(pathname) || pathname.startsWith("/api/auth/")) {
    const response = NextResponse.next({ request: { headers: request.headers } });
    response.headers.set("x-request-id", requestId);
    response.headers.set("x-pathname", pathname);
    return response;
  }

  // Usa o middleware OFICIAL do Neon Auth, não uma chamada manual a
  // `/get-session`. Além de validar a sessão, ele propaga o header interno que
  // o SDK espera e, principalmente, devolve os Set-Cookie de renovação. A versão
  // anterior só lia o JSON de get-session e descartava esses cookies: a UI podia
  // continuar vendo o usuário pelo cache de sessão enquanto `/token` já devolvia
  // AuthRequiredError, exatamente o 500 visto em Agenda/auth/interface.
  let response: NextResponse;
  try {
    response = await neonAuth.middleware({ loginUrl: "/login" })(request);
  } catch (error) {
    console.error("[proxy] Neon Auth indisponível", error);
    return NextResponse.json(
      {
        error: {
          code: "auth_unavailable",
          message: "Authentication temporarily unavailable",
        },
      },
      { status: 503, headers: { "x-request-id": requestId } },
    );
  }

  // O middleware oficial redireciona quando a sessão não é válida. Para APIs,
  // preservamos o contrato JSON/401 do CRM em vez de devolver HTML de /login.
  if (response.headers.get("location")) {
    if (pathname.startsWith("/api/")) {
      const semSessao = NextResponse.json(
        {
          error: {
            code: "unauthenticated",
            message: "Authentication required",
          },
        },
        { status: 401, headers: { "x-request-id": requestId } },
      );
      copiarCookiesDeAuth(response, semSessao);
      return semSessao;
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname + search);
    const redirect = NextResponse.redirect(loginUrl);
    copiarCookiesDeAuth(response, redirect);
    redirect.headers.set("x-request-id", requestId);
    return redirect;
  }

  response.headers.set("x-request-id", requestId);
  response.headers.set("x-pathname", pathname);

  if (pathname.startsWith("/app")) {
    const impCookie = request.cookies.get(IMPERSONATE_COOKIE_NAME_EDGE)?.value;
    if (impCookie) {
      const result = await verifyImpersonateCookieEdge(
        impCookie,
        env.IMPERSONATE_COOKIE_SECRET ?? "",
      );
      if (!result.valid) {
        console.warn(
          `[middleware] impersonate cookie invalid (${result.reason ?? "unknown"}) — clearing`,
        );
        response.cookies.delete(IMPERSONATE_COOKIE_NAME_EDGE);
      }
    }
  }

  if (
    isAdminSurface &&
    pathname.startsWith("/admin") &&
    pathname !== "/admin/forbidden"
  ) {
    if (!(await ehPlatformAdmin(request))) {
      return NextResponse.redirect(new URL("/admin/forbidden", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
  ],
};
