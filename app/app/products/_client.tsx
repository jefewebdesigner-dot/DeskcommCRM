"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import { MagnifyingGlass, Plus, Storefront, UploadSimple } from "@/lib/ui/icons";
import { apiClient } from "@/lib/api/client";
import { formatCents } from "@/lib/money";
import { precoParaCentavos, type Produto } from "@/lib/schemas/produtos";

interface Textos {
  titulo: string;
  subtitulo: string;
  vazio: string;
  vazioDica: string;
}

interface ResumoDaImportacao {
  total_linhas: number;
  criados: number;
  atualizados: number;
  erros: Array<{ linha: number; motivo: string }>;
  colunas_ignoradas: string[];
}

interface Rascunho {
  codigo: string;
  nome: string;
  marca: string;
  categoria: string;
  preco: string;
  custo: string;
  quantidade: string;
  controla_estoque: boolean;
}

const VAZIO: Rascunho = {
  codigo: "",
  nome: "",
  marca: "",
  categoria: "",
  preco: "",
  custo: "",
  quantidade: "0",
  controla_estoque: true,
};

function doRascunho(
  r: Rascunho,
  t: (s: string) => string,
): Record<string, unknown> | { erro: string } {
  const preco_cents = precoParaCentavos(r.preco);
  if (preco_cents === null) return { erro: t("Preço inválido. Escreva assim: 5.499,00") };
  const custo_cents = r.custo.trim() === "" ? null : precoParaCentavos(r.custo);
  if (r.custo.trim() !== "" && custo_cents === null) return { erro: t("Custo inválido.") };

  return {
    codigo: r.codigo.trim(),
    nome: r.nome.trim(),
    ...(r.marca.trim() ? { marca: r.marca.trim() } : {}),
    ...(r.categoria.trim() ? { categoria: r.categoria.trim() } : {}),
    preco_cents,
    custo_cents,
    controla_estoque: r.controla_estoque,
    quantidade: Number(r.quantidade) || 0,
  };
}

export function ProdutosClient({
  inicial,
  podeEditar,
  textos,
}: {
  inicial: Produto[];
  podeEditar: boolean;
  textos: Textos;
}) {
  const t = useT();
  const router = useRouter();
  const [busca, setBusca] = React.useState("");
  const [criando, setCriando] = React.useState(false);
  const [rascunho, setRascunho] = React.useState<Rascunho>(VAZIO);
  const [salvando, setSalvando] = React.useState(false);
  const [importando, setImportando] = React.useState(false);
  const [resumo, setResumo] = React.useState<ResumoDaImportacao | null>(null);
  const arquivoRef = React.useRef<HTMLInputElement>(null);

  const filtrados = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (q === "") return inicial;
    return inicial.filter((p) =>
      [p.nome, p.codigo, p.marca ?? "", p.categoria ?? ""].join(" ").toLowerCase().includes(q),
    );
  }, [inicial, busca]);

  const ativos = inicial.filter((p) => p.ativo).length;
  const semEstoque = inicial.filter(
    (p) => p.ativo && p.controla_estoque && p.quantidade <= 0,
  ).length;

  async function salvar() {
    const corpo = doRascunho(rascunho, t);
    if ("erro" in corpo) {
      toast.error(corpo.erro as string);
      return;
    }
    setSalvando(true);
    try {
      await apiClient.post("/api/v1/products", corpo);
      toast.success(t("Produto cadastrado"));
      setRascunho(VAZIO);
      setCriando(false);
      router.refresh();
    } catch (e) {
      showApiError(e);
    } finally {
      setSalvando(false);
    }
  }

  async function importar(arquivo: File) {
    setImportando(true);
    setResumo(null);
    try {
      const form = new FormData();
      form.append("file", arquivo);
      const res = await fetch("/api/v1/products/import", { method: "POST", body: form });
      const json = (await res.json()) as
        { data: ResumoDaImportacao } | { error?: { message?: string } };
      if (!res.ok || !("data" in json)) {
        const msg = "error" in json ? json.error?.message : undefined;
        toast.error(msg ?? t("Não consegui ler essa planilha."));
        return;
      }
      // O resumo fica NA TELA, não num toast que some em 4 segundos: quem
      // importou 300 produtos precisa ler quais linhas foram recusadas e por quê.
      setResumo(json.data);
      router.refresh();
    } catch {
      toast.error(t("Não consegui enviar o arquivo."));
    } finally {
      setImportando(false);
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  }

  async function alternarAtivo(p: Produto) {
    try {
      await apiClient.patch(`/api/v1/products/${p.id}`, { ativo: !p.ativo });
      toast.success(t(p.ativo ? "Produto desativado" : "Produto reativado"));
      router.refresh();
    } catch (e) {
      showApiError(e);
    }
  }

  return (
    <div
      className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 sm:p-6"
      data-testid="tela-produtos"
    >
      <header className="relative overflow-hidden rounded-[24px] border border-border/60 bg-gradient-to-br from-card via-card to-muted/35 p-5 shadow-[0_10px_32px_rgba(0,0,0,0.045)] sm:p-6">
        <div
          className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full bg-primary/[0.045] blur-3xl"
          aria-hidden="true"
        />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              {t("Catálogo comercial")}
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-[-0.045em] sm:text-[2rem]">
              {textos.titulo}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{textos.subtitulo}</p>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-[11px] font-medium text-muted-foreground shadow-sm">
            <Storefront size={14} weight="duotone" aria-hidden />
            {t("Fonte de preço do atendente de IA")}
          </span>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-3" aria-label={t("Resumo do catálogo")}>
        {[
          { label: t("Total"), value: inicial.length, helper: t("produtos cadastrados") },
          { label: t("Ativos"), value: ativos, helper: t("podem ser oferecidos") },
          { label: t("Sem estoque"), value: semEstoque, helper: t("precisam de atenção") },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm"
          >
            <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              {item.label}
            </p>
            <div className="mt-2 flex items-end justify-between gap-3">
              <p className="text-2xl font-semibold tracking-[-0.04em] tabular-nums">{item.value}</p>
              <p className="text-right text-[11px] leading-snug text-muted-foreground">
                {item.helper}
              </p>
            </div>
          </div>
        ))}
      </section>

      <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="relative min-w-0 flex-1 lg:max-w-lg">
          <MagnifyingGlass
            size={15}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={t("Buscar por nome, código, marca ou categoria")}
            aria-label={t("Buscar produtos")}
            className="h-9 w-full rounded-xl border border-border/60 bg-muted/25 pr-3 pl-9 text-sm transition-[background,border-color,box-shadow] outline-none placeholder:text-muted-foreground/70 focus:border-primary/30 focus:bg-background focus:ring-2 focus:ring-primary/10"
            data-testid="busca-produto"
          />
        </div>
        {podeEditar ? (
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/api/v1/products/import"
              download="modelo-catalogo.csv"
              className="inline-flex h-9 items-center rounded-xl px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              data-testid="modelo-planilha"
            >
              {t("Baixar modelo CSV")}
            </a>
            <input
              ref={arquivoRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              data-testid="arquivo-planilha"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importar(f);
              }}
            />
            <Button
              variant="outline"
              className="rounded-xl"
              disabled={importando}
              onClick={() => arquivoRef.current?.click()}
              data-testid="importar-planilha"
            >
              <UploadSimple size={16} aria-hidden />
              {t(importando ? "Importando…" : "Importar planilha")}
            </Button>
            <Button
              className="rounded-xl"
              onClick={() => setCriando((v) => !v)}
              data-testid="novo-produto"
            >
              <Plus size={16} aria-hidden />
              {t(criando ? "Cancelar" : "Novo produto")}
            </Button>
          </div>
        ) : null}
      </div>

      {resumo ? (
        <section
          className="rounded-2xl border border-border/60 bg-muted/[0.12] p-4 text-sm shadow-sm"
          data-testid="resumo-importacao"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold tracking-tight">{t("Importação concluída")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {resumo.criados} {t("novos")} · {resumo.atualizados} {t("atualizados")} ·{" "}
                {resumo.total_linhas} {t("linhas na planilha")}
              </p>
            </div>
            <button
              type="button"
              className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              onClick={() => setResumo(null)}
            >
              {t("Fechar")}
            </button>
          </div>
          {resumo.colunas_ignoradas.length > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {t("Não usei estas colunas:")} {resumo.colunas_ignoradas.join(", ")}.
            </p>
          ) : null}
          {resumo.erros.length > 0 ? (
            <div className="border-warning-border/60 mt-3 rounded-xl border bg-warning-bg/25 p-3">
              <p className="text-xs font-semibold">{t("Linhas que não entraram:")}</p>
              <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                {resumo.erros.slice(0, 20).map((e) => (
                  <li key={`${e.linha}-${e.motivo}`}>
                    {t("Linha")} {e.linha}: {e.motivo}
                  </li>
                ))}
              </ul>
              {resumo.erros.length > 20 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("…e mais")} {resumo.erros.length - 20}.
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {criando && podeEditar ? (
        <section
          className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm sm:p-5"
          data-testid="form-produto"
        >
          <div className="mb-4">
            <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              {t("Novo item")}
            </p>
            <h2 className="mt-1 text-base font-semibold tracking-tight">
              {t("Cadastrar produto")}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(
                "O preço e a disponibilidade cadastrados aqui podem ser usados pelo atendente de IA.",
              )}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["codigo", "Código", rascunho.codigo],
                ["nome", "Nome", rascunho.nome],
                ["marca", "Marca", rascunho.marca],
                ["categoria", "Categoria", rascunho.categoria],
              ] as const
            ).map(([campo, rotulo, valor]) => (
              <label key={campo} className="text-xs font-medium text-muted-foreground">
                {t(rotulo)}
                <input
                  value={valor}
                  onChange={(e) => setRascunho({ ...rascunho, [campo]: e.target.value })}
                  className="mt-1.5 h-9 w-full rounded-xl border border-border/60 bg-muted/[0.12] px-3 text-sm text-foreground transition-colors outline-none focus:border-primary/30 focus:bg-background"
                  data-testid={
                    campo === "codigo"
                      ? "produto-codigo"
                      : campo === "nome"
                        ? "produto-nome"
                        : undefined
                  }
                />
              </label>
            ))}
            <label className="text-xs font-medium text-muted-foreground">
              {t("Preço de venda")}
              <input
                value={rascunho.preco}
                onChange={(e) => setRascunho({ ...rascunho, preco: e.target.value })}
                placeholder="5.499,00"
                className="mt-1.5 h-9 w-full rounded-xl border border-border/60 bg-muted/[0.12] px-3 text-sm text-foreground transition-colors outline-none focus:border-primary/30 focus:bg-background"
                data-testid="produto-preco"
              />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              {t("Custo")} <span className="font-normal">{t("(opcional)")}</span>
              <input
                value={rascunho.custo}
                onChange={(e) => setRascunho({ ...rascunho, custo: e.target.value })}
                placeholder="4.100,00"
                className="mt-1.5 h-9 w-full rounded-xl border border-border/60 bg-muted/[0.12] px-3 text-sm text-foreground transition-colors outline-none focus:border-primary/30 focus:bg-background"
              />
              <span className="mt-1 block text-[11px] leading-relaxed font-normal text-muted-foreground">
                {t("Ajuda a equipe a saber até onde pode negociar. Não aparece para o cliente.")}
              </span>
            </label>
          </div>

          <div className="mt-4 rounded-xl border border-border/60 bg-muted/[0.10] p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={rascunho.controla_estoque}
                onChange={(e) => setRascunho({ ...rascunho, controla_estoque: e.target.checked })}
                data-testid="produto-controla-estoque"
              />
              {t("Controlar estoque deste produto")}
            </label>
            {rascunho.controla_estoque ? (
              <label className="mt-3 block text-xs font-medium text-muted-foreground">
                {t("Quantidade")}
                <input
                  value={rascunho.quantidade}
                  onChange={(e) => setRascunho({ ...rascunho, quantidade: e.target.value })}
                  className="mt-1.5 h-9 w-32 rounded-xl border border-border/60 bg-background px-3 text-sm text-foreground"
                />
              </label>
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {t(
                  "Sem controle de estoque, o item continua disponível para produtos sob encomenda ou fracionados.",
                )}
              </p>
            )}
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              className="rounded-xl"
              onClick={salvar}
              disabled={salvando}
              data-testid="salvar-produto"
            >
              {t(salvando ? "Salvando…" : "Salvar produto")}
            </Button>
          </div>
        </section>
      ) : null}

      {filtrados.length === 0 ? (
        <div
          className="rounded-2xl border border-dashed border-border/60 bg-muted/[0.06] p-10 text-center"
          data-testid="produtos-vazio"
        >
          <span
            className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground"
            aria-hidden="true"
          >
            <Storefront size={20} weight="duotone" />
          </span>
          <p className="mt-3 font-semibold tracking-tight">{textos.vazio}</p>
          <p className="mx-auto mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {textos.vazioDica}
          </p>
        </div>
      ) : (
        <ul className="space-y-2" data-testid="lista-produtos">
          {filtrados.map((p) => {
            const esgotado = p.ativo && p.controla_estoque && p.quantidade <= 0;
            return (
              <li
                key={p.id}
                className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card p-4 shadow-sm transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md sm:flex-row sm:items-center"
                data-testid={`produto-${p.codigo}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p
                      className={`truncate font-semibold tracking-[-0.01em] ${p.ativo ? "" : "text-muted-foreground line-through"}`}
                    >
                      {p.nome}
                    </p>
                    <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {p.codigo}
                    </span>
                    {!p.ativo ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {t("Inativo")}
                      </span>
                    ) : esgotado ? (
                      <span className="rounded-full bg-warning-bg px-2 py-0.5 text-[10px] font-medium text-warning-fg">
                        {t("Sem estoque")}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[p.marca, p.categoria].filter(Boolean).join(" · ") ||
                      t("Sem marca ou categoria")}
                    {" · "}
                    {p.controla_estoque
                      ? `${p.quantidade} ${t("em estoque")}`
                      : t("sem controle de estoque")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                  <span className="text-base font-semibold tracking-[-0.02em] tabular-nums">
                    {formatCents(p.preco_cents, p.moeda)}
                  </span>
                  {podeEditar ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-xl text-xs"
                      onClick={() => void alternarAtivo(p)}
                      data-testid={`alternar-${p.codigo}`}
                    >
                      {t(p.ativo ? "Desativar" : "Reativar")}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
