import { createHash, randomBytes } from "node:crypto";

import { metadataInicialDoCanal } from "@/lib/ai/elegibilidade/pre-go-live";
import type { Json } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWahaClient } from "@/lib/waha/client";

type ChannelRow = {
  id: string;
  waha_session_name: string | null;
  display_name: string | null;
  phone_number: string | null;
  status: string;
  archived_at: string | null;
};

const CHANNEL_COLUMNS =
  "id,waha_session_name,display_name,phone_number,status,archived_at";

export function nomeDaSessaoProvisionada(
  organizationId: string,
  integration: string,
  externalId: string,
): string {
  const org = organizationId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "tenant";
  const digest = createHash("sha256")
    .update(integration + ":" + externalId)
    .digest("hex")
    .slice(0, 24);
  return `st_${org}_${digest}`;
}

function managedMetadata(integration: string, externalId: string): Json {
  return {
    ...metadataInicialDoCanal(),
    external_provisioning: {
      managed: true,
      integration,
      external_id: externalId,
    },
  } as Json;
}

async function carregarCanal(
  organizationId: string,
  sessionName: string,
): Promise<ChannelRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("channel_sessions")
    .select(CHANNEL_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("provider", "waha")
    .eq("waha_session_name", sessionName)
    .maybeSingle();
  if (error) throw new Error("channel_lookup_failed: " + error.message);
  return data as ChannelRow | null;
}

export async function loadProvisionedWahaChannel(input: {
  organizationId: string;
  integration: string;
  externalId: string;
}): Promise<ChannelRow | null> {
  return carregarCanal(
    input.organizationId,
    nomeDaSessaoProvisionada(input.organizationId, input.integration, input.externalId),
  );
}

export async function provisionExternalWahaChannel(input: {
  organizationId: string;
  integration: string;
  externalId: string;
  displayName?: string;
}): Promise<{
  organization_id: string;
  channel_session_id: string;
  session_name: string;
  status: string;
  phone_number: string | null;
  replay: boolean;
  requires_pairing: boolean;
}> {
  const waha = getWahaClient();
  if (!waha) throw new Error("waha_not_configured");

  const admin = createAdminClient();
  const sessionName = nomeDaSessaoProvisionada(
    input.organizationId,
    input.integration,
    input.externalId,
  );

  let channel = await carregarCanal(input.organizationId, sessionName);
  const replay = !!channel;

  if (channel?.archived_at) {
    throw new Error("managed_channel_archived");
  }

  if (!channel) {
    const payload = {
      organization_id: input.organizationId,
      provider: "waha",
      waha_session_name: sessionName,
      display_name: input.displayName?.trim().slice(0, 100) || "WhatsApp",
      engine: "NOWEB",
      webhook_path_token: randomBytes(16).toString("hex"),
      webhook_secret_encrypted: "\\x00",
      status: "STARTING",
      status_reason: "external_provisioning",
      daily_message_limit: 250,
      metadata: managedMetadata(input.integration, input.externalId),
    };

    const created = await admin
      .from("channel_sessions")
      .insert(payload)
      .select(CHANNEL_COLUMNS)
      .single();

    if (created.error || !created.data) {
      channel = await carregarCanal(input.organizationId, sessionName);
      if (!channel) {
        throw new Error(
          "channel_create_failed: " + (created.error?.message ?? "no_row"),
        );
      }
    } else {
      channel = created.data as ChannelRow;
    }
  }

  try {
    const remote = await waha.startSession(sessionName);
    const now = new Date().toISOString();
    const updated = await admin
      .from("channel_sessions")
      .update({
        status: remote.status,
        status_reason: null,
        last_health_check_at: now,
        last_status_change_at: now,
      })
      .eq("organization_id", input.organizationId)
      .eq("id", channel.id)
      .select(CHANNEL_COLUMNS)
      .single();

    if (updated.error || !updated.data) {
      throw new Error(
        "channel_sync_failed: " + (updated.error?.message ?? "no_row"),
      );
    }

    const row = updated.data as ChannelRow;
    return {
      organization_id: input.organizationId,
      channel_session_id: row.id,
      session_name: sessionName,
      status: row.status,
      phone_number: row.phone_number,
      replay,
      requires_pairing: row.status !== "WORKING",
    };
  } catch (error) {
    await admin
      .from("channel_sessions")
      .update({
        status: "FAILED",
        status_reason: "external_provisioning_failed",
        last_status_change_at: new Date().toISOString(),
      })
      .eq("organization_id", input.organizationId)
      .eq("id", channel.id);
    throw error;
  }
}
