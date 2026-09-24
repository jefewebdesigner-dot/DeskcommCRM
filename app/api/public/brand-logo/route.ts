import { NextResponse, type NextRequest } from "next/server";

import {
  BUCKET_DE_LOGOS,
  FORMA_DO_NOME_DO_LOGO,
} from "@/lib/branding/logo";
import { neonStorage } from "@/lib/neon/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function caminhoPermitido(path: string): boolean {
  const partes = path.split("/");
  if (partes.length !== 2) return false;
  const [prefixo, arquivo] = partes;
  if (!prefixo || !arquivo || !FORMA_DO_NOME_DO_LOGO.test(arquivo)) return false;
  return (
    prefixo === "platform" ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      prefixo,
    )
  );
}

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path")?.trim() ?? "";
  if (!caminhoPermitido(path)) {
    return new NextResponse(null, { status: 404 });
  }

  const { data, error } = await neonStorage()
    .from(BUCKET_DE_LOGOS)
    .download(path);
  if (error || !data) {
    return new NextResponse(null, { status: 404 });
  }

  const bytes = await data.arrayBuffer();
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "content-type": path.endsWith(".png") ? "image/png" : "image/jpeg",
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      "x-content-type-options": "nosniff",
    },
  });
}
