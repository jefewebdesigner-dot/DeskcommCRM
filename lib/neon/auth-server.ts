import "server-only";

import { createNeonAuth } from "@neondatabase/neon-js/auth/next/server";
import { env } from "@/lib/env";

/**
 * Fonte única de autenticação server-side.
 * O cookie secret é gerado pelo Gravity e nunca vai ao browser.
 */
export const neonAuth = createNeonAuth({
  baseUrl: env.NEON_AUTH_BASE_URL,
  cookies: {
    secret: env.NEON_AUTH_COOKIE_SECRET,
    sessionDataTtl: 300,
    sameSite: "strict",
  },
});
