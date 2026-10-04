"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  configurarPontePje,
  desconectarPontePje,
  testarPontePje,
} from "@/app/actions/admin/configurarPontePje";
import { atualizarTokenPje } from "@/app/actions/admin/updatePjeToken";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function formatarValidade(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function FormularioTokenPje({
  configuradoInicial,
  last4Inicial,
  expiraEmInicial,
  expiradoInicial,
  ponteConfiguradaInicial,
  emailLegadoInicial,
}: {
  configuradoInicial: boolean;
  last4Inicial: string | null;
  expiraEmInicial: string | null;
  expiradoInicial: boolean | null;
  ponteConfiguradaInicial: boolean;
  emailLegadoInicial: string | null;
}) {
  const [token, setToken] = useState("");
  const [configurado, setConfigurado] = useState(configuradoInicial);
  const [last4, setLast4] = useState(last4Inicial);
  const [expiraEm, setExpiraEm] = useState(expiraEmInicial);
  const [expirado, setExpirado] = useState(expiradoInicial);
  const [ponteConfigurada, setPonteConfigurada] = useState(
    ponteConfiguradaInicial,
  );
  const [emailLegado, setEmailLegado] = useState(emailLegadoInicial ?? "");
  const [senhaLegado, setSenhaLegado] = useState("");
  const [salvando, iniciar] = useTransition();
  const [mexendoPonte, iniciarPonte] = useTransition();

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
      setExpiraEm(resultado.expiraEm);
      setExpirado(resultado.expirado);

      if (resultado.sincronizacaoLegado === "ok") {
        toast.success("Token Ouro atualizado no CRM e no PeríciaIA.");
      } else if (resultado.sincronizacaoLegado === "nao_configurada") {
        toast.warning(
          "Token salvo no CRM. Conecte o admin antigo abaixo para ele valer também no PeríciaIA atual.",
        );
      } else {
        toast.warning(
          "Token salvo no CRM, mas o PeríciaIA antigo não confirmou a atualização. Verifique a ponte abaixo.",
        );
      }
    });
  }

  function conectarPonte() {
    iniciarPonte(async () => {
      const resultado = await configurarPontePje(emailLegado, senhaLegado);
      if (!resultado.ok) {
        toast.error(resultado.erro);
        return;
      }

      setSenhaLegado("");
      setPonteConfigurada(true);
      toast.success(
        resultado.tokenAtualSincronizado
          ? "Admin antigo conectado e Token Ouro atual sincronizado."
          : "Admin antigo conectado.",
      );
    });
  }

  function verificarPonte() {
    iniciarPonte(async () => {
      const resultado = await testarPontePje();
      if (resultado.ok) {
        toast.success("Ponte com o admin antigo funcionando.");
      } else {
        toast.error(resultado.erro);
      }
    });
  }

  function desconectar() {
    iniciarPonte(async () => {
      await desconectarPontePje();
      setPonteConfigurada(false);
      setSenhaLegado("");
      toast.success("Ponte com o admin antigo removida.");
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Token Ouro global</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Você atualiza uma vez. O CRM guarda a credencial cifrada e, com a
              ponte conectada, replica para o PeríciaIA que atende os clientes
              hoje.
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
        {configurado && (
          <div className="mt-3 border-t pt-3">
            {expirado === true ? (
              <p className="text-xs font-medium text-red-600 dark:text-red-400">
                Token expirado
                {expiraEm ? ` em ${formatarValidade(expiraEm)}` : ""}. Atualize
                antes de importar processos.
              </p>
            ) : expirado === false ? (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                Validade informada pelo token: até {formatarValidade(expiraEm)}.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                O token está salvo, mas não expõe uma data de expiração legível.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="pje-global-token">Token Ouro (Jus.br / PJe)</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="pje-global-token"
            data-testid="pje-global-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={
              configurado
                ? "Cole aqui somente para substituir"
                : "Cole o token atual"
            }
            disabled={salvando}
          />
          <Button
            onClick={salvar}
            disabled={salvando || token.trim().length < 10}
          >
            {salvando
              ? "Atualizando…"
              : configurado
                ? "Atualizar token"
                : "Salvar token"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Depois de salvo, o token nunca volta para o navegador. Apenas os
          últimos quatro caracteres ficam visíveis.
        </p>
      </div>

      <div className="border-t pt-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Ponte com o PeríciaIA atual</p>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Conexão server-to-server com o admin antigo. A senha mestre fica
              cifrada e é usada apenas para criar uma sessão temporária no
              momento da sincronização.
            </p>
          </div>
          <span
            className={
              ponteConfigurada
                ? "rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400"
                : "rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400"
            }
          >
            {ponteConfigurada ? "Conectada" : "Não conectada"}
          </span>
        </div>

        {!ponteConfigurada ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pje-legacy-email">
                E-mail do admin antigo
              </Label>
              <Input
                id="pje-legacy-email"
                type="email"
                autoComplete="username"
                value={emailLegado}
                onChange={(e) => setEmailLegado(e.target.value)}
                placeholder="admin@periciaia.com.br"
                disabled={mexendoPonte}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pje-legacy-password">
                Senha do admin antigo
              </Label>
              <Input
                id="pje-legacy-password"
                type="password"
                autoComplete="current-password"
                value={senhaLegado}
                onChange={(e) => setSenhaLegado(e.target.value)}
                placeholder="Senha mestre"
                disabled={mexendoPonte}
              />
            </div>
            <div className="sm:col-span-2">
              <Button
                variant="outline"
                onClick={conectarPonte}
                disabled={
                  mexendoPonte ||
                  !emailLegado.trim() ||
                  senhaLegado.length < 6
                }
              >
                {mexendoPonte ? "Conectando…" : "Conectar admin antigo"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={verificarPonte}
              disabled={mexendoPonte}
            >
              {mexendoPonte ? "Verificando…" : "Verificar conexão"}
            </Button>
            <Button
              variant="ghost"
              onClick={desconectar}
              disabled={mexendoPonte}
            >
              Desconectar
            </Button>
            {emailLegado && (
              <span className="text-xs text-muted-foreground">
                {emailLegado}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
