import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

const PREFIXO = "dskprov1";
const SEGREDO_MINIMO = 32;
export const BLUEPRINT_CAPABILITY_TTL_SECONDS = 15 * 60;
export const CHANNEL_CAPABILITY_TTL_SECONDS = 15 * 60;

type CapabilityBase = {
  v: 1;
  organization_id: string;
  integration: string;
  external_id: string;
  iat: number;
  exp: number;
  jti: string;
};

export type BlueprintCapability = CapabilityBase & {
  scope: "tenant:blueprint";
};

export type ChannelCapability = CapabilityBase & {
  scope: "tenant:channel";
};

type AnyProvisioningCapability = BlueprintCapability | ChannelCapability;
type CapabilityScope = AnyProvisioningCapability["scope"];

function segredo(): string | null {
  const s = env.TENANT_PROVISIONING_SECRET.trim();
  return s.length >= SEGREDO_MINIMO ? s : null;
}

function assinatura(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(PREFIXO + "." + payloadB64)
    .digest("base64url");
}

export function tenantProvisioningEnabled(): boolean {
  return segredo() !== null;
}

function mintCapability(
  scope: CapabilityScope,
  input: {
    organizationId: string;
    integration: string;
    externalId: string;
    ttlSeconds?: number;
    nowSeconds?: number;
  },
  defaultTtl: number,
): string {
  const secret = segredo();
  if (!secret) throw new Error("tenant_provisioning_disabled");

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttl = Math.max(60, Math.min(60 * 60, input.ttlSeconds ?? defaultTtl));
  const payload: AnyProvisioningCapability = {
    v: 1,
    scope,
    organization_id: input.organizationId,
    integration: input.integration,
    external_id: input.externalId,
    iat: now,
    exp: now + ttl,
    jti: randomBytes(12).toString("base64url"),
  } as AnyProvisioningCapability;
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return [PREFIXO, payloadB64, assinatura(payloadB64, secret)].join(".");
}

export function mintBlueprintCapability(input: {
  organizationId: string;
  integration: string;
  externalId: string;
  ttlSeconds?: number;
  nowSeconds?: number;
}): string {
  return mintCapability("tenant:blueprint", input, BLUEPRINT_CAPABILITY_TTL_SECONDS);
}

export function mintChannelCapability(input: {
  organizationId: string;
  integration: string;
  externalId: string;
  ttlSeconds?: number;
  nowSeconds?: number;
}): string {
  return mintCapability("tenant:channel", input, CHANNEL_CAPABILITY_TTL_SECONDS);
}

function verifyCapability<T extends CapabilityScope>(
  token: string | null | undefined,
  expectedScope: T,
  options: { nowSeconds?: number } = {},
): Extract<AnyProvisioningCapability, { scope: T }> | null {
  const secret = segredo();
  if (!secret || !token) return null;

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIXO) return null;
  const [, payloadB64, sig] = parts;
  if (!payloadB64 || !sig) return null;

  const expected = assinatura(payloadB64, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: AnyProvisioningCapability;
  try {
    payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as AnyProvisioningCapability;
  } catch {
    return null;
  }

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    payload.v !== 1 ||
    payload.scope !== expectedScope ||
    typeof payload.organization_id !== "string" ||
    typeof payload.integration !== "string" ||
    typeof payload.external_id !== "string" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number" ||
    typeof payload.jti !== "string" ||
    payload.exp <= now ||
    payload.iat > now + 30 ||
    payload.exp - payload.iat > 60 * 60
  ) {
    return null;
  }

  return payload as Extract<AnyProvisioningCapability, { scope: T }>;
}

export function verifyBlueprintCapability(
  token: string | null | undefined,
  options: { nowSeconds?: number } = {},
): BlueprintCapability | null {
  return verifyCapability(token, "tenant:blueprint", options);
}

export function verifyChannelCapability(
  token: string | null | undefined,
  options: { nowSeconds?: number } = {},
): ChannelCapability | null {
  return verifyCapability(token, "tenant:channel", options);
}
