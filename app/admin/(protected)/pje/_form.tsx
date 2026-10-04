"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { atualizarTokenPje } from "@/app/actions/admin/updatePjeToken";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function FormularioTokenPje({
  configuradoInicial,
  last4Inicial,
}: {
  configuradoInicial: boolean;
  last4Inicial: string | null;
}) {
  const [token, setToken] = useState("");
  const [configurado, setConfigurado] = useState(configuradoInicial);
  const [last4, setLast4] = useState(last4Inicial);
  const [salvando, iniciar] = useTransition();

  function salvar() {
    iniciar(async () => {
      const resultado = await atualizarTokenPje(token);
      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }
      setToken("");
      setConfigurado(true);
      setLast4(resultado.last4);
      toast.success("Token PJe atualizado para toda a instalação.");
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Credencial central</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Um único token é compartilhado pelo backend da instalação. Clientes não veem nem alteram este valor.
            </p>
          </div>
          <span
            className={
              configurado
                ? "rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400"
                : "rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400"
            }
          >
            {configurado ? `Configurado ••••${last4 ?? ""}` : "Não configurado"}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="pje-global-token">Token PJe</Label>
        <div className="flex gap-2">
          <Input
            id="pje-global-token"
            data-testid="pje-global-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={configurado ? "Cole aqui somente para substituir" : "Cole o token atual"}
            disabled={salvando}
          />
          <Button onClick={salvar} disabled={salvando || token.trim().length < 10}>
            {salvando ? "Salvando…" : configurado ? "Atualizar token" : "Salvar token"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Depois de salvo, o token não volta para o navegador. Apenas os últimos quatro caracteres ficam visíveis para conferência.
        </p>
      </div>
    </div>
  );
}
