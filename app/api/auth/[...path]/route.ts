import { neonAuth } from "@/lib/neon/auth-server";

export const dynamic = "force-dynamic";

export const { GET, POST } = neonAuth.handler();
