import { wahaPayloadSchema, type WahaPayload } from "@/lib/waha/envelope";

export function payloadHistoricoDoStore(raw: unknown): WahaPayload | null {
  const parsed = wahaPayloadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
