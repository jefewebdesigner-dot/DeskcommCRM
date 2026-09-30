"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { BillingDashboard, BillingSourceError, StripeDashboard } from "@/lib/billing-export/contracts";

type State = { configured: boolean; dashboard: BillingDashboard | null };
type ResumoOperacional = {
  contatos: number;
  negocios_abertos: number;
  aguardando_atendimento: number;
  tarefas_abertas: number;
  tarefas_atrasadas: number;
  compromissos_30d: number;
  meta_atribuicao_30d: { oportunidades: number; vendas: number; receita_cents: number; moeda: string };
  prontidao: {
    responsaveis_ativos: number | null;
    whatsapp: { total: number | null; conectados: number | null };
    agenda_google: { total: number | null; saudaveis: number | null };
    inteligencia_artificial: { credenciais_ativas: number | null; validadas: number | null };
    meta_ads: { conectada: boolean | null };
  };
  atualizado_em: string;
};

type ResumoMeta = { gasto: number; conversas: number; custoPorConversa: number | null; campanhasAtivas: number; moeda: string; periodo: string };
const currency = (cents: number | null, code = "BRL") =>
  cents === null
    ? "Não disponível"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(cents / 100);
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
      }).format(new Date(value))
    : "Não informado";
const statusName = (value: string) =>
  ({
    active: "Ativa",
    past_due: "Em atraso",
    canceled: "Cancelada",
    trialing: "Em teste",
    paid: "Pago",
    pending: "Pendente",
    overdue: "Vencido",
    failed: "Falhou",
  })[value] ?? value;
const sourceError = (error: BillingSourceError) =>
  ({
    unauthorized: "A fonte recusou a credencial. Revise a conexão.",
    unavailable: "A fonte não respondeu. Tente atualizar novamente.",
    invalid_data:
      "A fonte retornou um formato diferente do esperado. Os números não foram calculados.",
  })[error];

function Metric({ title, value, note }: { title: string; value: string | number; note: string }) {
  return (
    <article className="min-w-0 rounded-xl border border-border bg-card p-5 shadow-sm">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight break-words tabular-nums">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{note}</p>
    </article>
  );
}
function ReadinessCard({
  title,
  ready,
  detail,
  href,
}: {
  title: string;
  ready: boolean | null;
  detail: string;
  href: string;
}) {
  const label = ready === null ? "Verificar" : ready ? "Pronto" : "Pendente";
  return (
    <article className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{title}</p>
        <Badge variant={ready ? "default" : "outline"}>{label}</Badge>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p>
      <Link className="mt-3 inline-block text-xs font-medium underline underline-offset-4" href={href}>
        Abrir configuração
      </Link>
    </article>
  );
}
function DashboardCharts({ stripe }: { stripe: StripeDashboard }) {
  const receita = stripe.monthly_revenue.slice(-12);
  const planos = stripe.plans.filter((item) => item.count > 0);
  const pieFills = ["hsl(var(--primary))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];
  return (
    <section aria-label="Gráficos do negócio" className="grid gap-4 lg:grid-cols-5">
      <div className="rounded-xl border border-border bg-card p-5 lg:col-span-3">
        <h2 className="font-semibold">Evolução do faturamento</h2>
        <p className="mb-4 text-xs text-muted-foreground">Receita mensal confirmada pela fonte Stripe.</p>
        {receita.length ? (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={receita} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={72} tickFormatter={(v: number) => currency(v)} />
              <Tooltip formatter={(value) => [currency(Number(value)), "Receita"]} />
              <Line type="monotone" dataKey="revenue_cents" name="Receita" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : <Empty>Sem histórico mensal suficiente.</Empty>}
      </div>
      <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
        <h2 className="font-semibold">Clientes por plano</h2>
        <p className="mb-4 text-xs text-muted-foreground">Distribuição das assinaturas ativas por plano.</p>
        {planos.length ? (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={planos} dataKey="count" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2}>
                {planos.map((item, index) => <Cell key={item.name} fill={pieFills[index % pieFills.length]} />)}
              </Pie>
              <Tooltip formatter={(value) => [Number(value), "Clientes"]} />
              <Legend verticalAlign="bottom" height={30} />
            </PieChart>
          </ResponsiveContainer>
        ) : <Empty>Sem distribuição por plano disponível.</Empty>}
      </div>
    </section>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-card">
      <header className="border-b border-border p-5">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}
function Person({ name, email }: { name: string | null; email: string | null }) {
  return (
    <div className="min-w-0 break-words">
      <p className="font-medium">{name || email || "Cliente sem identificação"}</p>
      {name && email && <p className="text-xs text-muted-foreground">{email}</p>}
    </div>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

export function BillingDashboardClient({
  canConfigure,
  organizationName,
  organizationId,
}: {
  canConfigure: boolean;
  organizationName: string;
  organizationId: string;
}) {
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [configure, setConfigure] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [tab, setTab] = useState<"subscriptions" | "payments" | "renewals">("subscriptions");
  const [operacao, setOperacao] = useState<ResumoOperacional | null>(null);
  const [erroOperacao, setErroOperacao] = useState<string | null>(null);
  const [meta, setMeta] = useState<ResumoMeta | null>(null);
  const [erroMeta, setErroMeta] = useState<string | null>(null);

  async function request(method = "GET", signal?: AbortSignal, credential?: string) {
    const timeout = AbortSignal.timeout(45000);
    const response = await fetch("/api/v1/billing-export", {
      method,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Organization-Id": organizationId },
      ...(credential ? { body: JSON.stringify({ token: credential }) } : {}),
    }).catch(() => {
      throw new Error(
        "Não foi possível consultar o painel. Verifique sua conexão e tente novamente.",
      );
    });
    const json = (await response.json().catch(() => null)) as {
      data?: State;
      error?: { message?: string };
    } | null;
    if (!response.ok || !json?.data)
      throw new Error(json?.error?.message ?? "Não foi possível consultar o painel.");
    return json.data;
  }

  useEffect(() => {
    const controller = new AbortController();
    // Cada montagem pertence a uma organização; a página usa key=organizationId.
    void request("GET", controller.signal)
      .then(setState)
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Não foi possível carregar o painel.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // A identidade da organização é a fronteira de vida deste componente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/dashboard/resumo", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const json = (await response.json().catch(() => null)) as { data?: ResumoOperacional } | null;
        if (!response.ok || !json?.data) throw new Error("Resumo operacional indisponível.");
        setOperacao(json.data);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setErroOperacao(e instanceof Error ? e.message : "Resumo operacional indisponível.");
      });
    return () => controller.abort();
  }, [organizationId]);

  useEffect(() => {
    const controller = new AbortController();
    async function carregarMeta() {
      const contasRes = await fetch("/api/v1/ads/meta/accounts", { cache: "no-store", signal: controller.signal });
      const contasJson = await contasRes.json().catch(() => null) as { data?: { contas: Array<{ id: string; moeda: string; status: number }>; conta_padrao: string | null } } | null;
      if (!contasRes.ok || !contasJson?.data) throw new Error("Meta Ads ainda não está disponível.");
      const conta = contasJson.data.contas.find((c) => c.id === contasJson.data?.conta_padrao) ?? contasJson.data.contas.find((c) => c.status === 1) ?? contasJson.data.contas[0];
      if (!conta) throw new Error("Nenhuma conta de anúncios disponível.");
      const fim = new Date(Date.now() - 86400000);
      const inicio = new Date(fim.getTime() - 29 * 86400000);
      const de = inicio.toISOString().slice(0, 10);
      const ate = fim.toISOString().slice(0, 10);
      const url = "/api/v1/ads/meta/campaigns?account_id=" + encodeURIComponent(conta.id) + "&from=" + de + "&to=" + ate;
      const campRes = await fetch(url, { cache: "no-store", signal: controller.signal });
      const campJson = await campRes.json().catch(() => null) as { data?: { campanhas: Array<{ gasto: number | null; veiculacao: string | null; resultado: { valor: number | null; indicador: string | null } }> } } | null;
      if (!campRes.ok || !campJson?.data) throw new Error("Não foi possível consultar as campanhas da Meta.");
      const linhas = campJson.data.campanhas;
      const gasto = linhas.reduce((n, c) => n + (c.gasto ?? 0), 0);
      const conversas = linhas.reduce((n, c) => c.resultado.indicador?.includes("messaging_conversation_started") ? n + (c.resultado.valor ?? 0) : n, 0);
      setMeta({ gasto, conversas, custoPorConversa: conversas > 0 ? gasto / conversas : null, campanhasAtivas: linhas.filter((c) => c.veiculacao === "ACTIVE").length, moeda: conta.moeda, periodo: de + " a " + ate });
    }
    void carregarMeta().catch((e: unknown) => { if (!controller.signal.aborted) setErroMeta(e instanceof Error ? e.message : "Meta Ads indisponível."); });
    return () => controller.abort();
  }, [organizationId]);

  async function refresh() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      setState(await request());
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Falha ao atualizar. Os dados anteriores permanecem na tela.",
      );
    } finally {
      setLoading(false);
    }
  }
  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setState(await request("PUT", undefined, token));
      setToken("");
      setConfigure(false);
      setNotice("Conexão salva e validada nas duas fontes.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setState(await request("DELETE"));
      setToken("");
      setNotice(
        "Conexão removida desta organização. As assinaturas no sistema de origem permanecem intactas.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível desconectar.");
    } finally {
      setBusy(false);
    }
  }

  const dashboard = state?.dashboard;
  const stripe = dashboard?.stripe.ok ? dashboard.stripe.data : null;
  const other = dashboard?.other.ok ? dashboard.other.data : null;
  const filtered =
    other?.subscriptions.filter(
      (row) =>
        (status === "all" || row.status === status) &&
        `${row.name ?? ""} ${row.email ?? ""}`
          .toLocaleLowerCase("pt-BR")
          .includes(query.toLocaleLowerCase("pt-BR")),
    ) ?? [];
  const maxRevenue = Math.max(
    1,
    ...(stripe?.monthly_revenue.map((row) => Math.abs(row.revenue_cents)) ?? []),
  );

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              {organizationName} · Gestão comercial
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Dashboard
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Veja vendas, atendimento, tarefas, agenda e receita da operação em um só lugar.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={loading || busy} onClick={refresh}>
              {loading ? "Consultando…" : "Atualizar dados"}
            </Button>
            {canConfigure && (
              <Button
                variant="outline"
                onClick={() => setConfigure(!configure)}
                aria-expanded={configure}
              >
                {configure ? "Fechar configuração" : "Configurar conexão"}
              </Button>
            )}
          </div>
        </header>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
          >
            {error}
            {dashboard && (
              <p className="mt-1">
                A atualização falhou. Confira a data dos dados anteriores abaixo.
              </p>
            )}
          </div>
        )}
        {notice && (
          <p role="status" className="rounded-lg border border-border bg-muted p-4 text-sm">
            {notice}
          </p>
        )}
        {loading && !state && (
          <div role="status" aria-label="Carregando dados financeiros" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-xl border border-border bg-muted/50" />)}
          </div>
        )}

        {stripe && other && (
          <section aria-label="Visão geral combinada">
            <div className="mb-3">
              <h2 className="font-semibold">Visão geral · Stripe + PIX/manual</h2>
              <p className="text-xs text-muted-foreground">Todos os clientes e valores juntos. O detalhamento por fonte fica logo abaixo.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                title="Contratos ativos"
                value={`${stripe.active_subscriptions + other.subscriptions.filter((row) => row.status === "active").length} contratos`}
                note={`${stripe.active_subscriptions} assinatura(s) ativa(s) no Stripe + ${other.subscriptions.filter((row) => row.status === "active").length} no PIX/manual. Clientes em atraso são mostrados separadamente.`}
              />
              <Metric title="Receita recorrente mensal (total)" value={currency(stripe.mrr_cents + (other.mrr_cents ?? 0))} note={`Stripe ${currency(stripe.mrr_cents)} + PIX/manual ${currency(other.mrr_cents)}.`} />
              <Metric title="Receita recorrente anual (total)" value={currency(stripe.arr_cents + (other.mrr_cents ?? 0) * 12)} note="ARR do Stripe (informado pela fonte) + MRR do PIX/manual × 12." />
              <Metric title="Em atraso (total)" value={stripe.past_due_count + other.past_due_customers} note={`${stripe.past_due_count} no Stripe + ${other.past_due_customers} no PIX/manual.`} />
            </div>
          </section>
        )}

        <section aria-label="Visão geral operacional">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="font-semibold">Visão geral</h2>
              <p className="text-xs text-muted-foreground">Dados do CRM da PeríciaIA, respeitando o acesso da organização.</p>
            </div>
            {operacao && <p className="text-xs text-muted-foreground">Atualizado em {date(operacao.atualizado_em)}</p>}
          </div>
          {erroOperacao ? (
            <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm">{erroOperacao}</p>
          ) : operacao ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Metric title="Contatos" value={operacao.contatos} note="Pessoas cadastradas no CRM." />
              <Metric title="Negócios abertos" value={operacao.negocios_abertos} note="Oportunidades ainda em andamento nos funis." />
              <Metric title="Aguardando atendimento" value={operacao.aguardando_atendimento} note="Conversas abertas sob comando humano." />
              <Metric title="Tarefas abertas" value={operacao.tarefas_abertas} note={operacao.tarefas_atrasadas + " atrasada(s) precisam de atenção."} />
              <Metric title="Compromissos · 30 dias" value={operacao.compromissos_30d} note="Agendamentos pendentes ou confirmados." />
              <Metric title="Atenção necessária" value={operacao.tarefas_atrasadas + operacao.aguardando_atendimento} note="Tarefas atrasadas + conversas aguardando atendimento." />
            </div>
          ) : (
            <p role="status" className="rounded-lg border border-border p-4 text-sm text-muted-foreground">Carregando resumo operacional…</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link href="/app/inbox">Abrir Inbox</Link></Button>
            <Button asChild variant="outline"><Link href="/app/kanban">Abrir Funis</Link></Button>
            <Button asChild variant="outline"><Link href="/app/contacts">Contatos</Link></Button>
            <Button asChild variant="outline"><Link href="/app/tasks">Tarefas</Link></Button>
            <Button asChild variant="outline"><Link href="/app/agenda">Agenda</Link></Button>
          </div>
        </section>

        {operacao && (
          <section aria-label="Prontidão da operação">
            <div className="mb-3">
              <h2 className="font-semibold">Prontidão da operação</h2>
              <p className="text-xs text-muted-foreground">
                O que já está realmente configurado para a PeríciaIA operar sem depender de ajuste manual.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <ReadinessCard
                title="Responsáveis"
                ready={operacao.prontidao.responsaveis_ativos === null ? null : operacao.prontidao.responsaveis_ativos > 0}
                detail={operacao.prontidao.responsaveis_ativos === null ? "Não foi possível conferir a equipe." : `${operacao.prontidao.responsaveis_ativos} responsável(is) apto(s) a receber negócios e atendimentos.`}
                href="/app/team"
              />
              <ReadinessCard
                title="Agenda Google"
                ready={operacao.prontidao.agenda_google.saudaveis === null ? null : operacao.prontidao.agenda_google.saudaveis > 0}
                detail={operacao.prontidao.agenda_google.total === null ? "Não foi possível conferir as contas conectadas." : `${operacao.prontidao.agenda_google.saudaveis ?? 0} saudável(is) de ${operacao.prontidao.agenda_google.total} conexão(ões).`}
                href="/app/agenda"
              />
              <ReadinessCard
                title="WhatsApp"
                ready={operacao.prontidao.whatsapp.conectados === null ? null : operacao.prontidao.whatsapp.conectados > 0}
                detail={operacao.prontidao.whatsapp.total === null ? "Não foi possível conferir os canais." : `${operacao.prontidao.whatsapp.conectados ?? 0} conectado(s) de ${operacao.prontidao.whatsapp.total} canal(is).`}
                href="/app/connections"
              />
              <ReadinessCard
                title="Inteligência artificial"
                ready={operacao.prontidao.inteligencia_artificial.validadas === null ? null : operacao.prontidao.inteligencia_artificial.validadas > 0}
                detail={operacao.prontidao.inteligencia_artificial.credenciais_ativas === null ? "Não foi possível conferir as credenciais." : `${operacao.prontidao.inteligencia_artificial.validadas ?? 0} validada(s) de ${operacao.prontidao.inteligencia_artificial.credenciais_ativas} credencial(is) ativa(s).`}
                href="/app/ai/credentials"
              />
              <ReadinessCard
                title="Meta Ads"
                ready={operacao.prontidao.meta_ads.conectada}
                detail={operacao.prontidao.meta_ads.conectada === null ? "Não foi possível conferir a conexão de leitura." : operacao.prontidao.meta_ads.conectada ? "Token de leitura conectado para alimentar os indicadores do Dashboard." : "Falta conectar o token de leitura da conta de anúncios."}
                href="/app/settings/meta-ads"
              />
              <ReadinessCard
                title="Cobrança e contratos"
                ready={state === null ? null : state.configured}
                detail={state === null ? "Conferindo a integração financeira." : state.configured ? "Fonte financeira conectada ao Dashboard." : "Integração financeira ainda não configurada para esta organização."}
                href="/app/assinaturas"
              />
            </div>
          </section>
        )}

        {(configure || state?.configured === false) && (
          <Section
            title={state?.configured ? "Conexão de cobrança" : "Conecte os dados da PeríciaIA"}
            description="Consulta os dados do admin PeríciaIA, com Stripe, AbacatePay e registros manuais. A configuração vale somente para esta organização."
          >
            {canConfigure ? (
              <form onSubmit={connect} className="max-w-xl space-y-4">
                <div>
                  <label htmlFor="billing-token" className="text-sm font-medium">
                    Token de integração
                  </label>
                  <Input
                    id="billing-token"
                    type="password"
                    autoComplete="new-password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder={
                      state?.configured
                        ? "Informe um novo token para substituir"
                        : "Informe o token fornecido pelo admin"
                    }
                    minLength={16}
                    maxLength={2048}
                    required
                    className="mt-2"
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    A credencial é protegida no servidor e não é exibida após salvar.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={busy || loading || token.trim().length < 16}>
                    {busy ? "Aguarde…" : "Validar e salvar conexão"}
                  </Button>
                  {state?.configured && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy || loading}
                      onClick={disconnect}
                    >
                      Desconectar
                    </Button>
                  )}
                </div>
              </form>
            ) : (
              <p className="text-sm">
                Peça a um administrador da organização para configurar a conexão.
              </p>
            )}
          </Section>
        )}

        {dashboard && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <p>Consultado em {date(dashboard.fetched_at)} · horário de Brasília</p>
              <Badge variant="outline">Somente consulta</Badge>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm leading-relaxed">
              As fontes usam contagens diferentes: <strong>assinaturas no Stripe</strong> e{" "}
              <strong>clientes no PIX/manual</strong>. Os totais abaixo somam as duas; o
              detalhamento por fonte, mais adiante, existe porque a API do Stripe não fornece o
              cadastro completo para deduplicar clientes entre elas.
            </div>
            {!dashboard.stripe.ok && (
              <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm">
                <strong>Stripe indisponível.</strong> {sourceError(dashboard.stripe.error)}
              </p>
            )}
            {!dashboard.other.ok && (
              <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm">
                <strong>PIX e manual indisponíveis.</strong> {sourceError(dashboard.other.error)}
              </p>
            )}


            {(stripe || other) && (
              <section aria-label="Vendas e caixa">
                <div className="mb-3">
                  <h2 className="font-semibold">Vendas e caixa</h2>
                  <p className="text-xs text-muted-foreground">
                    Hoje e este mês, juntando as fontes onde o número é confiável.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {other && (
                    <Metric
                      title="Vendas hoje · PIX/manual"
                      value={currency(other.vendas_hoje_cents)}
                      note={`${other.vendas_hoje_count} pagamento(s) confirmado(s) hoje. Contagem exata (exportação completa).`}
                    />
                  )}
                  {stripe && (
                    <Metric
                      title="Vendas hoje · Stripe (amostra)"
                      value={currency(stripe.vendas_hoje_amostra_cents)}
                      note={`${stripe.vendas_hoje_amostra_count} pagamento(s) entre os 5 mais recentes que a fonte manda — não é o total do dia, só o que caiu na amostra.`}
                    />
                  )}
                  {(other || stripe?.receita_mes_atual_cents !== null) && (
                    <Metric
                      title="Vendas do mês (combinado)"
                      value={currency(
                        (other?.vendas_mes_cents ?? 0) + (stripe?.receita_mes_atual_cents ?? 0),
                      )}
                      note={
                        other && stripe
                          ? `PIX/manual: ${currency(other.vendas_mes_cents)} (exato, ${other.vendas_mes_count} pagamentos). Stripe: ${currency(stripe.receita_mes_atual_cents)} (agregado ${stripe.receita_mes_atual_label ?? "do mês"}, calculado pela fonte).`
                          : "Soma do que cada fonte disponível confirma para o mês corrente."
                      }
                    />
                  )}
                  {other && (
                    <Metric
                      title="A receber em 30 dias · PIX/manual"
                      value={currency(other.a_receber_30d_cents)}
                      note={`${other.a_receber_30d_count} renovação(ões) prevista(s) nos próximos 30 dias. Assinaturas canceladas não entram.`}
                    />
                  )}
                  {stripe && (
                    <Metric
                      title="Renovações em 30 dias · Stripe"
                      value={stripe.renovacoes_30d_count}
                      note="A fonte não envia o valor por renovação — só a contagem e a data."
                    />
                  )}
                </div>
              </section>
            )}

            <section aria-label="Aquisição e conversão">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="font-semibold">Aquisição e conversão · Meta Ads</h2>
                  <p className="text-xs text-muted-foreground">Últimos 30 dias completos. Dados lidos diretamente da conta de anúncios.</p>
                </div>
                <Button asChild variant="outline" size="sm"><Link href="/app/ads/meta">Ver campanhas</Link></Button>
              </div>
              {meta ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric title="Investimento em anúncios" value={meta.gasto.toLocaleString("pt-BR", { style: "currency", currency: meta.moeda })} note={meta.periodo} />
                  <Metric title="Conversas iniciadas" value={meta.conversas} note="Resultado atribuído pela Meta às campanhas de mensagens." />
                  <Metric title="Custo por conversa" value={meta.custoPorConversa === null ? "—" : meta.custoPorConversa.toLocaleString("pt-BR", { style: "currency", currency: meta.moeda })} note="Investimento ÷ conversas iniciadas." />
                  <Metric title="Campanhas ativas" value={meta.campanhasAtivas} note="Campanhas com veiculação ativa na conta consultada." />
                  <Metric title="Oportunidades atribuídas" value={operacao?.meta_atribuicao_30d.oportunidades ?? "—"} note="Negócios dos últimos 30 dias com clique Meta comprovado no CRM." />
                  <Metric title="Vendas atribuídas" value={operacao?.meta_atribuicao_30d.vendas ?? "—"} note="Negócios ganhos com atribuição Meta comprovada." />
                  <Metric title="Receita atribuída" value={operacao ? currency(operacao.meta_atribuicao_30d.receita_cents, operacao.meta_atribuicao_30d.moeda) : "—"} note="Somente vendas atribuídas à Meta e com valor registrado no CRM." />
                  <Metric title="ROAS atribuído" value={operacao && meta.gasto > 0 && operacao.meta_atribuicao_30d.receita_cents > 0 ? `${(operacao.meta_atribuicao_30d.receita_cents / 100 / meta.gasto).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x` : "—"} note="Receita atribuída ÷ investimento. Só aparece com venda e valor comprovados." />
                </div>
              ) : erroMeta ? (
                <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">{erroMeta} <Link className="underline" href="/app/settings/meta-ads">Configurar Meta Ads</Link></p>
              ) : <div className="h-28 animate-pulse rounded-xl border border-border bg-muted/50" />}
              <p className="mt-3 text-xs text-muted-foreground">A atribuição usa o identificador real do clique gravado no contato/negócio. Venda sem vínculo comprovado não entra no ROAS.</p>
            </section>

            {stripe && <DashboardCharts stripe={stripe} />}

            {stripe && (
              <section aria-label="Indicadores Stripe">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold">Stripe</h2>
                    {stripe.verificado_direto ? (
                      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                        Verificado direto na Stripe
                      </Badge>
                    ) : (
                      <Badge variant="outline">Resumo do admin PeríciaIA</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Fonte gerada em {date(stripe.generated_at)}
                  </p>
                </div>
                {!stripe.verificado_direto && (
                  <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed">
                    <strong>Atenção:</strong> o resumo que o admin do PeríciaIA envia para "assinaturas
                    ativas" tem um bug medido em 27/09/2026 — ele conta assinaturas <em>canceladas</em>{" "}
                    como ativas. Sem a chave da Stripe configurada neste ambiente, os números abaixo
                    ainda refletem esse bug.
                  </p>
                )}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Metric
                    title="Assinaturas ativas"
                    value={stripe.active_subscriptions}
                    note={
                      stripe.verificado_direto
                        ? "Contagem real, paginada direto na Stripe."
                        : "Contagem informada pelo Stripe; não representa clientes únicos."
                    }
                  />
                  <Metric
                    title="Receita recorrente mensal"
                    value={currency(stripe.mrr_cents)}
                    note={
                      stripe.verificado_direto
                        ? "MRR calculado a partir das assinaturas ativas de verdade."
                        : "MRR informado pela fonte. Não equivale ao caixa recebido no mês."
                    }
                  />
                  <Metric
                    title="Em atraso"
                    value={stripe.past_due_count}
                    note={
                      stripe.verificado_direto
                        ? "Contagem real de assinaturas com status past_due na Stripe."
                        : "Contagem past_due informada pelo Stripe. Veja a lista de atenção abaixo."
                    }
                  />
                  <Metric
                    title="Receita recorrente anual"
                    value={currency(stripe.arr_cents)}
                    note="ARR informado pela fonte Stripe."
                  />
                  <Metric
                    title="Churn nos últimos 90 dias"
                    value={`${stripe.churn_rate_90d}%`}
                    note={`${stripe.churned_90d} cancelamentos no período. Taxa calculada pela fonte; denominador não informado.`}
                  />
                  <Metric
                    title="Cancelamento programado"
                    value={stripe.canceling_count}
                    note="Assinaturas com cancelamento ao final do período. Priorize a retenção."
                  />
                </div>
              </section>
            )}
            {other && (
              <section aria-label="Indicadores PIX e manual">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold">PIX e registros manuais</h2>
                  <p className="text-xs text-muted-foreground">
                    Fonte gerada em {date(other.generated_at)}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Metric
                    title="Clientes ativos"
                    value={other.active_customers}
                    note={`${other.customer_count} cadastros na exportação v2, incluindo inativos. IDs separados por provedor.`}
                  />
                  <Metric
                    title="Receita recorrente mensal"
                    value={currency(other.mrr_cents)}
                    note="MRR do resumo v2 em BRL. Valores de ciclos semestrais e anuais já mensalizados pela fonte."
                  />
                  <Metric
                    title="Clientes em atraso"
                    value={other.past_due_customers}
                    note={`MRR em risco: ${currency(other.mrr_at_risk_cents)}. Não representa o saldo total da dívida.`}
                  />
                </div>
              </section>
            )}

            {stripe && (
              <div className="grid min-w-0 gap-6 lg:grid-cols-2">
                <Section
                  title="Receita recebida · Stripe"
                  description="Histórico mensal informado pela fonte. O histórico PIX/manual não está consolidado neste gráfico."
                >
                  <div className="space-y-3">
                    {stripe.monthly_revenue.length === 0 ? (
                      <Empty>Sem histórico informado.</Empty>
                    ) : (
                      stripe.monthly_revenue.map((row) => (
                        <div
                          key={row.month}
                          className="grid grid-cols-[4.5rem_minmax(0,1fr)_6.5rem] items-center gap-2 text-xs"
                        >
                          <span>{row.month}</span>
                          <div
                            className="h-3 overflow-hidden rounded-full bg-muted"
                            aria-hidden="true"
                          >
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{
                                width: `${(Math.abs(row.revenue_cents) / maxRevenue) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="text-right tabular-nums">
                            {currency(row.revenue_cents)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </Section>
                <Section
                  title="Distribuição por plano · Stripe"
                  description="Nomes dos planos conforme o cadastro financeiro. Produtos e preços atuais podem ter nomes diferentes."
                >
                  <div className="divide-y divide-border">
                    {stripe.plans.map((row) => (
                      <div
                        key={row.name}
                        className="flex flex-wrap items-center justify-between gap-3 py-4"
                      >
                        <div>
                          <p className="font-medium">{row.name}</p>
                          <p className="text-xs text-muted-foreground">{row.count} assinaturas</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold tabular-nums">{currency(row.mrr_cents)}</p>
                          <p className="text-xs text-muted-foreground">MRR</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              </div>
            )}

            <Section
              title="Atenção à carteira"
              description="Consulte os registros para priorizar atendimento, retenção e conferência de pagamentos. Nenhuma cobrança ou mensagem é enviada por este painel."
            >
              <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Tipo de registro">
                {(
                  [
                    ["subscriptions", "Clientes e assinaturas"],
                    ["payments", "Pagamentos"],
                    ["renewals", "Renovações Stripe"],
                  ] as const
                ).map(([key, title]) => (
                  <Button
                    key={key}
                    variant={tab === key ? "default" : "outline"}
                    onClick={() => setTab(key)}
                    aria-pressed={tab === key}
                  >
                    {title}
                  </Button>
                ))}
              </div>
              {tab === "subscriptions" && (
                <>
                  {stripe && (
                    <div className="mb-6 rounded-lg bg-muted/40 p-4">
                      <h3 className="text-sm font-semibold">
                        Em atraso · Stripe ({stripe.past_due_count})
                      </h3>
                      {stripe.past_due.length ? (
                        <div className="mt-3 space-y-3">
                          {stripe.past_due.map((row, i) => (
                            <Person key={i} {...row} />
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-muted-foreground">
                          {stripe.past_due_count === 0
                            ? "Nenhum atraso informado pelo Stripe."
                            : "A fonte informou atrasos, mas não enviou os detalhes dos clientes."}
                        </p>
                      )}
                    </div>
                  )}
                  <h3 className="text-sm font-semibold">Assinaturas · PIX e manual</h3>
                  {other ? (
                    <>
                      <div className="my-4 flex flex-col gap-3 sm:flex-row">
                        <Input
                          aria-label="Buscar cliente"
                          placeholder="Buscar por nome ou e-mail"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          className="sm:max-w-sm"
                        />
                        <select
                          aria-label="Situação da assinatura"
                          value={status}
                          onChange={(e) => setStatus(e.target.value)}
                          className="h-9 max-w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <option value="all">Todas as situações</option>
                          <option value="active">Ativas</option>
                          <option value="past_due">Em atraso</option>
                          <option value="canceled">Canceladas</option>
                        </select>
                      </div>
                      <p className="mb-2 text-xs text-muted-foreground">
                        {filtered.length} registros encontrados
                      </p>
                      <div className="max-h-[32rem] divide-y divide-border overflow-y-auto">
                        {filtered.length ? (
                          filtered.map((row) => (
                            <article
                              key={row.id}
                              className="grid min-w-0 gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                            >
                              <Person {...row} />
                              <div className="text-sm">
                                <Badge variant="outline">{statusName(row.status)}</Badge>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {row.provider === "abacatepay" ? "AbacatePay" : "Manual"}
                                </p>
                              </div>
                              <div className="text-sm sm:text-right">
                                <p className="font-medium tabular-nums">
                                  {currency(row.amount_cents, row.currency)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Ciclo: {row.interval_count}{" "}
                                  {row.interval === "month"
                                    ? "mês(es)"
                                    : row.interval === "year"
                                      ? "ano(s)"
                                      : row.interval}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Fim do período: {date(row.renews_at)}
                                </p>
                              </div>
                            </article>
                          ))
                        ) : (
                          <Empty>Nenhuma assinatura corresponde aos filtros.</Empty>
                        )}
                      </div>
                    </>
                  ) : (
                    <Empty>Os registros PIX/manual não estão disponíveis nesta consulta.</Empty>
                  )}
                </>
              )}
              {tab === "payments" && (
                <div className="grid min-w-0 gap-6 lg:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">Pagamentos recentes · Stripe</h3>
                    {stripe ? (
                      stripe.payments.length ? (
                        stripe.payments.map((row, i) => (
                          <article
                            key={i}
                            className="flex flex-wrap justify-between gap-3 border-b border-border py-4"
                          >
                            <Person {...row} />
                            <div className="text-sm">
                              <p className="font-medium">{currency(row.amount_cents)}</p>
                              <p className="text-xs text-muted-foreground">{date(row.paid_at)}</p>
                            </div>
                          </article>
                        ))
                      ) : (
                        <Empty>Nenhum pagamento informado.</Empty>
                      )
                    ) : (
                      <Empty>Fonte indisponível.</Empty>
                    )}
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">
                      Pagamentos exportados · PIX/manual
                    </h3>
                    <p className="mb-3 text-xs text-muted-foreground">
                      Registros operacionais da exportação; não são um extrato bancário completo.
                    </p>
                    <div className="max-h-[32rem] overflow-y-auto">
                      {other ? (
                        other.payments.length ? (
                          other.payments.map((row) => (
                            <article
                              key={row.id}
                              className="flex flex-wrap justify-between gap-3 border-b border-border py-4"
                            >
                              <Person {...row} />
                              <div className="text-sm">
                                <p className="font-medium">
                                  {currency(
                                    row.status === "paid" ? row.amount_cents : row.amount_due_cents,
                                    row.currency,
                                  )}{" "}
                                  · {statusName(row.status)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {row.status === "paid"
                                    ? `Pago em ${date(row.paid_at)}`
                                    : `Vencimento: ${date(row.due_at)}`}
                                </p>
                                {row.status !== "paid" && (
                                  <p className="text-xs text-muted-foreground">
                                    Valor já pago: {currency(row.amount_cents, row.currency)}
                                  </p>
                                )}
                              </div>
                            </article>
                          ))
                        ) : (
                          <Empty>Nenhum pagamento informado.</Empty>
                        )
                      ) : (
                        <Empty>Fonte indisponível.</Empty>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {tab === "renewals" && (
                <>
                  {stripe ? (
                    stripe.renewals.length ? (
                      <div className="divide-y divide-border">
                        {stripe.renewals.map((row, i) => (
                          <article
                            key={i}
                            className="flex flex-wrap items-center justify-between gap-3 py-4"
                          >
                            <Person {...row} />
                            <div className="text-sm sm:text-right">
                              <p>{date(row.renews_at)}</p>
                              <Badge variant="outline">
                                {row.canceling ? "Cancelamento programado" : "Renovação prevista"}
                              </Badge>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <Empty>Nenhuma renovação enviada pela fonte.</Empty>
                    )
                  ) : (
                    <Empty>Fonte Stripe indisponível.</Empty>
                  )}
                </>
              )}
            </Section>
            <footer className="flex flex-wrap gap-4 text-sm">
              <Link className="underline underline-offset-4" href="/app/contacts">
                Abrir contatos do CRM
              </Link>
              <Link className="underline underline-offset-4" href="/app/kanban">
                Abrir funil comercial
              </Link>
              <Link className="underline underline-offset-4" href="/app/audit">
                Ver auditoria de configurações
              </Link>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
