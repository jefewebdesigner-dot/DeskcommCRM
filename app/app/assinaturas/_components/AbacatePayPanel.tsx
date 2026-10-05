"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Loader2, RefreshCw, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCents } from "@/lib/money";
import type { OtherDashboard } from "@/lib/billing-export/contracts";

interface State {
  configured: boolean;
  store: { id: string | null; name: string | null } | null;
  dashboard: OtherDashboard | null;
}

interface SyncResult {
  contactsCreated: number;
  contactsUpdated: number;
  dealsCreated: number;
  dealsUpdated: number;
  dealsMoved: number;
  conflicts: number;
  errors: number;
}

function leData<T>(json: unknown): T {
  return (json as { data: T }).data;
}
function leErro(json: unknown): string | null {
  return (json as { error?: { message?: string } })?.error?.message ?? null;
}

/**
 * Conexão direta com a AbacatePay (API real, não o bridge do admin legado
 * que a seção "Financeiro" acima usa) — painel próprio, de propósito:
 * conectar/desconectar uma fonte não deve arriscar o estado da outra.
 */
export function AbacatePayPanel({
  organizationId,
  canConfigure,
}: {
  organizationId: string;
  canConfigure: boolean;
}) {
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);

  async function carregar() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/integrations/abacatepay", {
        headers: { "X-Organization-Id": organizationId },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(leErro(json) ?? "Não foi possível carregar a AbacatePay.");
      setState(leData<State>(json));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar a AbacatePay.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  async function conectar(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/integrations/abacatepay", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Organization-Id": organizationId },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(leErro(json) ?? "Não foi possível conectar.");
      setApiKey("");
      setShowForm(false);
      await carregar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível conectar.");
    } finally {
      setBusy(false);
    }
  }

  async function desconectar() {
    setBusy(true);
    try {
      await fetch("/api/v1/integrations/abacatepay", {
        method: "DELETE",
        headers: { "X-Organization-Id": organizationId },
      });
      setLastSync(null);
      await carregar();
    } finally {
      setBusy(false);
    }
  }

  async function sincronizar() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/integrations/abacatepay/sync", {
        method: "POST",
        headers: { "X-Organization-Id": organizationId },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(leErro(json) ?? "Não foi possível sincronizar.");
      setLastSync(leData<SyncResult>(json));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível sincronizar.");
    } finally {
      setBusy(false);
    }
  }

  const d = state?.dashboard;

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Wallet className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold">AbacatePay</p>
            <p className="text-xs text-muted-foreground">
              {state?.configured && state.store?.name
                ? `Conectado — ${state.store.name}`
                : "Conexão direta com a API da AbacatePay"}
            </p>
          </div>
          {state?.configured ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              conectado
            </span>
          ) : null}
        </div>
        {canConfigure && (
          <div className="flex gap-2">
            {state?.configured && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || loading}
                onClick={sincronizar}
                className="gap-1.5 rounded-xl text-xs"
              >
                <RefreshCw className={"h-3.5 w-3.5 " + (busy ? "animate-spin" : "")} aria-hidden="true" />
                Sincronizar com o CRM
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowForm((v) => !v)}
              className="rounded-xl text-xs"
            >
              {state?.configured ? "Reconectar" : "Conectar"}
            </Button>
            {state?.configured && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={desconectar}
                className="rounded-xl text-xs text-destructive hover:text-destructive"
              >
                Desconectar
              </Button>
            )}
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

      {showForm && (
        <form onSubmit={conectar} className="mt-4 flex flex-wrap items-end gap-2">
          <div className="min-w-[260px] flex-1">
            <label htmlFor="abacatepay-key" className="text-xs font-medium text-muted-foreground">
              Chave de API (abc_prod_... ou abc_dev_...)
            </label>
            <Input
              id="abacatepay-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="abc_prod_..."
              className="mt-1"
              autoComplete="off"
            />
          </div>
          <Button type="submit" size="sm" disabled={busy || apiKey.trim().length < 16} className="rounded-xl">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </Button>
        </form>
      )}

      {lastSync && (
        <p className="mt-3 text-xs text-muted-foreground">
          Última sincronização: {lastSync.contactsCreated} contato(s) novo(s),{" "}
          {lastSync.contactsUpdated} atualizado(s), {lastSync.dealsCreated} card(s) novo(s),{" "}
          {lastSync.dealsMoved} movido(s)
          {lastSync.conflicts > 0 ? `, ${lastSync.conflicts} conflito(s) não tocados` : ""}
          {lastSync.errors > 0 ? `, ${lastSync.errors} erro(s)` : ""}.
        </p>
      )}

      {loading ? (
        <div className="mt-4 flex h-20 items-center justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : d ? (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { rotulo: "Clientes ativos", valor: d.active_customers },
            { rotulo: "Em atraso", valor: d.past_due_customers },
            {
              rotulo: "MRR",
              valor: d.mrr_cents == null ? "—" : formatCents(d.mrr_cents, "BRL"),
            },
            { rotulo: "Vendas (mês)", valor: `${d.vendas_mes_count} · ${formatCents(d.vendas_mes_cents, "BRL")}` },
          ].map((item) => (
            <div key={item.rotulo} className="rounded-xl border border-border/60 bg-muted/20 p-3">
              <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                {item.rotulo}
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{item.valor}</p>
            </div>
          ))}
        </div>
      ) : state?.configured === false ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Conecte a chave de API pra ver clientes, cobranças e MRR direto da AbacatePay aqui.
        </p>
      ) : null}
    </section>
  );
}
