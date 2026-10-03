/**
 * Nuvemshop integration status page.
 *
 * Three states:
 *   1. not_configured — env vars empty: shows "configure env" card.
 *   2. not_connected  — env ok, no tenant_integrations row: shows Connect button.
 *   3. connected      — row exists with status=healthy: shows store info + Disconnect.
 *
 * The Connect Server Action redirects to Nuvemshop's authorize URL. Callback
 * lives at /api/v1/integrations/nuvemshop/callback.
 */

import { Storefront } from "@/lib/ui/icons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConfigured } from "@/lib/nuvemshop/config";
import { ConnectButton, DisconnectButton } from "./_components/ConnectButton";
import { StatusToast } from "./_components/StatusToast";
import { Suspense } from "react";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";

interface IntegrationRow {
  id: string;
  status: string;
  scopes: string[];
  store_metadata: { store_id?: string } | null;
  webhook_subscriptions: Record<string, { id: number | null; error?: string }> | null;
  last_sync_at: string | null;
}

async function loadIntegration(orgId: string): Promise<IntegrationRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("tenant_integrations")
    .select("id, status, scopes, store_metadata, webhook_subscriptions, last_sync_at")
    .eq("organization_id", orgId)
    .eq("provider", "nuvemshop")
    .maybeSingle();
  return (data as IntegrationRow | null) ?? null;
}

export default async function NuvemshopIntegrationPage() {
  const user = await loadAuthUser();
  const activeOrg = user ? await resolveActiveOrg(user) : null;
  const configured = isConfigured();
  const idioma = normalizarIdioma(user?.locale ?? null);

  const integration = activeOrg && configured ? await loadIntegration(activeOrg.orgId) : null;

  const isAdmin =
    activeOrg?.role === "admin" || (user?.is_platform_admin === true && !user.support);

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <Suspense fallback={null}>
        <StatusToast />
      </Suspense>

      <header className="relative flex items-start gap-4 overflow-hidden rounded-[24px] border border-border/60 bg-gradient-to-br from-card via-card to-muted/35 p-5 shadow-[0_10px_32px_rgba(0,0,0,0.045)] sm:p-6">
        <div className="rounded-xl border border-border/60 bg-background/70 p-3 shadow-sm">
          <Storefront size={28} weight="duotone" className="text-muted-foreground" />
        </div>
        <div>
          <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Integração de loja
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">Nuvemshop</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {traduzir("Sincroniza pedidos, produtos e clientes via OAuth + webhooks.", idioma)}
          </p>
        </div>
      </header>

      {!configured ? (
        <Card className="rounded-[24px] border-border/60 shadow-sm">
          <CardHeader>
            <CardTitle>{traduzir("Integração não configurada", idioma)}</CardTitle>
            <CardDescription>
              {traduzir("Configure", idioma)}{" "}
              <code className="rounded-lg bg-muted px-1 py-0.5 text-xs">NUVEMSHOP_APP_ID</code>,{" "}
              <code className="rounded-lg bg-muted px-1 py-0.5 text-xs">NUVEMSHOP_CLIENT_ID</code>{" "}
              {traduzir("e", idioma)}{" "}
              <code className="rounded-lg bg-muted px-1 py-0.5 text-xs">
                NUVEMSHOP_CLIENT_SECRET
              </code>{" "}
              {traduzir("em", idioma)}{" "}
              <code className="rounded-lg bg-muted px-1 py-0.5 text-xs">.env.local</code>{" "}
              {traduzir("para ativar a integração.", idioma)}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {traduzir("Obtenha as credenciais em", idioma)}{" "}
            <a
              className="underline"
              href="https://partners.tiendanube.com/"
              target="_blank"
              rel="noreferrer"
            >
              partners.tiendanube.com
            </a>
            .
          </CardContent>
        </Card>
      ) : !integration || integration.status === "disconnected" ? (
        <Card className="rounded-[24px] border-border/60 shadow-sm">
          <CardHeader>
            <CardTitle>{traduzir("Conectar Nuvemshop", idioma)}</CardTitle>
            <CardDescription>
              {traduzir("Você será redirecionado para autorizar o app na sua loja.", idioma)}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ConnectButton disabled={!isAdmin} />
            {!isAdmin ? (
              <p className="text-xs text-muted-foreground">
                {traduzir("Somente administradores podem conectar integrações.", idioma)}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-[24px] border-border/60 shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                {traduzir("Conectado", idioma)}
                <Badge variant="secondary">{integration.status}</Badge>
              </CardTitle>
              <CardDescription>
                {traduzir("Loja", idioma)} #{integration.store_metadata?.store_id ?? "—"} ·{" "}
                {traduzir("última sync:", idioma)}{" "}
                {integration.last_sync_at
                  ? new Date(integration.last_sync_at).toLocaleString(tagDeIdioma(idioma))
                  : "—"}
              </CardDescription>
            </div>
            {isAdmin ? <DisconnectButton /> : null}
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <span className="font-medium">{traduzir("Escopos:", idioma)}</span>{" "}
              {integration.scopes.length > 0 ? (
                <span className="text-muted-foreground">{integration.scopes.join(", ")}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
            <div>
              <span className="font-medium">{traduzir("Webhooks registrados:", idioma)}</span>{" "}
              <span className="text-muted-foreground">
                {integration.webhook_subscriptions
                  ? Object.entries(integration.webhook_subscriptions).filter(
                      ([, v]) => v.id !== null,
                    ).length
                  : 0}{" "}
                / 8
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
