import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { isPublicPath } from "@/lib/auth/public-paths";
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

async function sessaoNeon(request: NextRequest) {
  const res = await fetch(
    `${env.NEON_AUTH_BASE_URL.replace(/\/$/, "")}/get-session`,
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
  const data = (await res.json().catch(() => null)) as
    | { user?: { id?: string } }
    | null;
  return data?.user?.id ? data : null;
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

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request: { headers: request.headers } });
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  response.headers.set("x-request-id", requestId);

  const { pathname, search } = request.nextUrl;
  response.headers.set("x-pathname", pathname);
  request.headers.set("x-pathname", pathname);

  const host = request.headers.get("host") ?? "";
  const isAdminSurface =
    host.startsWith("admin.") || pathname.startsWith("/admin");

  if (isPublicPath(pathname) || pathname.startsWith("/api/auth/")) {
    return response;
  }

  const session = await sessaoNeon(request);
  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          error: {
            code: "unauthenticated",
            message: "Authentication required",
          },
        },
        { status: 401, headers: { "x-request-id": requestId } },
      );
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

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
