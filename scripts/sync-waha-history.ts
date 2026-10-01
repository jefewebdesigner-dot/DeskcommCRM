import { createAdminClient } from "@/lib/supabase/admin";
import { getWahaClient } from "@/lib/waha/client";
import { sincronizarHistoricoWaha } from "@/lib/waha/history-sync";

async function main(): Promise<void> {
  const channelId = process.argv[2];
  if (!channelId) throw new Error("uso: sync-waha-history <channel_session_id>");

  const admin = createAdminClient();
  const { data: channel, error } = await admin
    .from("channel_sessions")
    .select("id,organization_id,waha_session_name,status,archived_at")
    .eq("id", channelId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!channel || channel.archived_at) throw new Error("canal_nao_encontrado");
  if (channel.status !== "WORKING") throw new Error("canal_nao_esta_working");

  const waha = getWahaClient();
  if (!waha) throw new Error("waha_nao_configurado");

  let ultimo = 0;
  const resumo = await sincronizarHistoricoWaha(
    admin,
    waha,
    {
      id: channel.id,
      organization_id: channel.organization_id,
      waha_session_name: channel.waha_session_name,
    },
    {
      onProgress(progress) {
        if (progress.chats_vistos - ultimo < 10) return;
        ultimo = progress.chats_vistos;
        console.info(JSON.stringify({ progress }));
      },
    },
  );

  console.info(JSON.stringify({ done: true, resumo }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
