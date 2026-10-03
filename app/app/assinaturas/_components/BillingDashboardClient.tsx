"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Megaphone,
  MessageCircleMore,
  RefreshCw,
  Settings2,
  Sparkles,
  Target,
  TrendingUp,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  BillingDashboard,
  BillingSourceError,
  StripeDashboard,
} from "@/lib/billing-export/contracts";

type State = { configured: boolean; dashboard: BillingDashboard | null };
type ResumoOperacional = {
  contatos: number;
  negocios_abertos: number;
  aguardando_atendimento: number;
  tarefas_abertas: number;
  tarefas_atrasadas: number;
  compromissos_30d: number;
  meta_atribuicao_30d: {
    oportunidades: number;
    vendas: number;
    receita_cents: number;
    moeda: string;
  };
  prontidao: {
    responsaveis_ativos: number | null;
    whatsapp: { total: number | null; conectados: number | null };
    agenda_google: { total: number | null; saudaveis: number | null };
    inteligencia_artificial: { credenciais_ativas: number | null; validadas: number | null };
    meta_ads: { conectada: boolean | null };
  };
  atualizado_em: string;
};

type ResumoMeta = {
  gasto: number;
  conversas: number;
  custoPorConversa: number | null;
  campanhasAtivas: number;
  moeda: string;
  periodo: string;
};
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

type MetricTone = "default" | "accent" | "success" | "warning";

function Metric({
  title,
  value,
  note,
  icon: Icon,
  tone = "default",
}: {
  title: string;
  value: string | number;
  note: string;
  icon?: LucideIcon;
  tone?: MetricTone;
}) {
  const toneClass = {
    default: "border-border/70 bg-card",
    accent: "border-primary/20 bg-primary/[0.035]",
    success: "border-emerald-500/20 bg-emerald-500/[0.035]",
    warning: "border-amber-500/25 bg-amber-500/[0.04]",
  }[tone];
  const iconClass = {
    default: "bg-muted text-muted-foreground",
    accent: "bg-primary/10 text-primary",
    success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  }[tone];

  return (
    <article
      className={`group relative min-h-[156px] min-w-0 overflow-hidden rounded-2xl border p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md ${toneClass}`}
    >
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-[15rem] text-[11px] leading-snug font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {title}
        </p>
        {Icon && (
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconClass}`}
            aria-hidden="true"
          >
            <Icon className="h-4 w-4" strokeWidth={1.8} />
          </span>
        )}
      </div>
      <p className="mt-5 text-[clamp(1.7rem,2.8vw,2.2rem)] leading-none font-semibold tracking-[-0.045em] break-words tabular-nums">
        {value}
      </p>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{note}</p>
    </article>
  );
}
function ReadinessCard({
  title,
  ready,
  detail,
  href,
  icon: Icon = Activity,
}: {
  title: string;
  ready: boolean | null;
  detail: string;
  href: string;
  icon?: LucideIcon;
}) {
  const label = ready === null ? "Verificar" : ready ? "Pronto" : "Pendente";
  const statusClass =
    ready === null
      ? "bg-muted text-muted-foreground"
      : ready
        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        : "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return (
    <article className="group min-w-0 rounded-2xl border border-border/70 bg-card p-4 shadow-sm transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-3">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClass}`}>
          {label}
        </span>
      </div>
      <p className="mt-4 font-semibold tracking-tight">{title}</p>
      <p className="mt-1.5 min-h-10 text-xs leading-relaxed text-muted-foreground">{detail}</p>
      <Link
        className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-foreground transition-colors hover:text-primary"
        href={href}
      >
        Abrir configuração <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </article>
  );
}
function DashboardCharts({ stripe }: { stripe: StripeDashboard }) {
  const receita = stripe.monthly_revenue.slice(-12);
  const planos = stripe.plans.filter((item) => item.count > 0);
  const pieFills = [
    "hsl(var(--primary))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
    "hsl(var(--chart-5))",
  ];
  return (
    <section aria-label="Gráficos do negócio" className="grid gap-4 lg:grid-cols-5">
      <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6 lg:col-span-3">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              Receita
            </p>
            <h2 className="mt-1 text-base font-semibold tracking-tight">Evolução do faturamento</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Receita mensal confirmada pela fonte Stripe.
            </p>
          </div>
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
            aria-hidden="true"
          >
            <TrendingUp className="h-4 w-4" strokeWidth={1.8} />
          </span>
        </div>
        {receita.length ? (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={receita} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={72}
                tickFormatter={(v: number) => currency(v)}
              />
              <Tooltip formatter={(value) => [currency(Number(value)), "Receita"]} />
              <Line
                type="monotone"
                dataKey="revenue_cents"
                name="Receita"
                stroke="hsl(var(--primary))"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <Empty>Sem histórico mensal suficiente.</Empty>
        )}
      </div>
      <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6 lg:col-span-2">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              Carteira
            </p>
            <h2 className="mt-1 text-base font-semibold tracking-tight">Clientes por plano</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Distribuição das assinaturas ativas por plano.
            </p>
          </div>
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
            aria-hidden="true"
          >
            <UsersRound className="h-4 w-4" strokeWidth={1.8} />
          </span>
        </div>
        {planos.length ? (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={planos}
                dataKey="count"
                nameKey="name"
                innerRadius={58}
                outerRadius={88}
                paddingAngle={2}
              >
                {planos.map((item, index) => (
                  <Cell key={item.name} fill={pieFills[index % pieFills.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => [Number(value), "Clientes"]} />
              <Legend verticalAlign="bottom" height={30} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <Empty>Sem distribuição por plano disponível.</Empty>
        )}
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
    <section className="min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
      <header className="border-b border-border/70 px-5 py-4 sm:px-6 sm:py-5">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </header>
      <div className="p-5 sm:p-6">{children}</div>
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
        const json = (await response.json().catch(() => null)) as {
          data?: ResumoOperacional;
        } | null;
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
      const contasRes = await fetch("/api/v1/ads/meta/accounts", {
        cache: "no-store",
        signal: controller.signal,
      });
      const contasJson = (await contasRes.json().catch(() => null)) as {
        data?: {
          contas: Array<{ id: string; moeda: string; status: number }>;
          conta_padrao: string | null;
        };
      } | null;
      if (!contasRes.ok || !contasJson?.data)
        throw new Error("Meta Ads ainda não está disponível.");
      const conta =
        contasJson.data.contas.find((c) => c.id === contasJson.data?.conta_padrao) ??
        contasJson.data.contas.find((c) => c.status === 1) ??
        contasJson.data.contas[0];
      if (!conta) throw new Error("Nenhuma conta de anúncios disponível.");
      const fim = new Date(Date.now() - 86400000);
      const inicio = new Date(fim.getTime() - 29 * 86400000);
      const de = inicio.toISOString().slice(0, 10);
      const ate = fim.toISOString().slice(0, 10);
      const url =
        "/api/v1/ads/meta/campaigns?account_id=" +
        encodeURIComponent(conta.id) +
        "&from=" +
        de +
        "&to=" +
        ate;
      const campRes = await fetch(url, { cache: "no-store", signal: controller.signal });
      const campJson = (await campRes.json().catch(() => null)) as {
        data?: {
          campanhas: Array<{
            gasto: number | null;
            veiculacao: string | null;
            resultado: { valor: number | null; indicador: string | null };
          }>;
        };
      } | null;
      if (!campRes.ok || !campJson?.data)
        throw new Error("Não foi possível consultar as campanhas da Meta.");
      const linhas = campJson.data.campanhas;
      const gasto = linhas.reduce((n, c) => n + (c.gasto ?? 0), 0);
      const conversas = linhas.reduce(
        (n, c) =>
          c.resultado.indicador?.includes("messaging_conversation_started")
            ? n + (c.resultado.valor ?? 0)
            : n,
        0,
      );
      setMeta({
        gasto,
        conversas,
        custoPorConversa: conversas > 0 ? gasto / conversas : null,
        campanhasAtivas: linhas.filter((c) => c.veiculacao === "ACTIVE").length,
        moeda: conta.moeda,
        periodo: de + " a " + ate,
      });
    }
    void carregarMeta().catch((e: unknown) => {
      if (!controller.signal.aborted)
        setErroMeta(e instanceof Error ? e.message : "Meta Ads indisponível.");
    });
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
  const contratosAtivos =
    stripe && other
      ? stripe.active_subscriptions +
        other.subscriptions.filter((row) => row.status === "active").length
      : null;
  const mrrTotal = stripe && other ? stripe.mrr_cents + (other.mrr_cents ?? 0) : null;
  const vendasMesTotal =
    stripe || other
      ? (other?.vendas_mes_cents ?? 0) + (stripe?.receita_mes_atual_cents ?? 0)
      : null;
  const atrasosFinanceiros =
    stripe && other ? stripe.past_due_count + other.past_due_customers : null;
  const atencaoOperacional = operacao
    ? operacao.tarefas_atrasadas + operacao.aguardando_atendimento
    : null;
  const prontidaoLista = operacao
    ? [
        operacao.prontidao.responsaveis_ativos === null
          ? null
          : operacao.prontidao.responsaveis_ativos > 0,
        operacao.prontidao.whatsapp.conectados === null
          ? null
          : operacao.prontidao.whatsapp.conectados > 0,
        operacao.prontidao.agenda_google.saudaveis === null
          ? null
          : operacao.prontidao.agenda_google.saudaveis > 0,
        operacao.prontidao.inteligencia_artificial.validadas === null
          ? null
          : operacao.prontidao.inteligencia_artificial.validadas > 0,
        operacao.prontidao.meta_ads.conectada,
        state === null ? null : state.configured,
      ]
    : [];
  const prontidaoOk = prontidaoLista.filter((item) => item === true).length;
  const prontidaoConhecida = prontidaoLista.filter((item) => item !== null).length;
  const atalhosOperacionais: Array<{ href: string; label: string; icon: LucideIcon }> = [
    { href: "/app/inbox", label: "Inbox", icon: MessageCircleMore },
    { href: "/app/kanban", label: "Funis", icon: Target },
    { href: "/app/contacts", label: "Contatos", icon: UsersRound },
    { href: "/app/tasks", label: "Tarefas", icon: BadgeCheck },
    { href: "/app/agenda", label: "Agenda", icon: CalendarDays },
  ];

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <header className="relative overflow-hidden rounded-[24px] border border-border/60 bg-gradient-to-br from-card via-card to-muted/35 px-5 py-5 shadow-[0_10px_32px_rgba(0,0,0,0.045)] sm:px-6 sm:py-6">
          <div
            className="pointer-events-none absolute -top-28 -right-24 h-64 w-64 rounded-full bg-primary/[0.055] blur-3xl"
            aria-hidden="true"
          />
          <div className="relative flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase backdrop-blur-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                  {organizationName}
                </span>
                <p className="text-[11px] font-medium text-muted-foreground">Central de operação</p>
              </div>
              <h1 className="mt-4 text-2xl font-semibold tracking-[-0.045em] sm:text-[2rem]">
                Dashboard
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Uma leitura rápida da receita, contratos e operação — com prioridade para o que
                exige ação agora.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={loading || busy}
                onClick={refresh}
                className="gap-2"
              >
                <RefreshCw
                  className={"h-4 w-4 " + (loading ? "animate-spin" : "")}
                  aria-hidden="true"
                />
                {loading ? "Atualizando…" : "Atualizar"}
              </Button>
              {canConfigure && (
                <Button
                  variant="outline"
                  onClick={() => setConfigure(!configure)}
                  aria-expanded={configure}
                  className="gap-2"
                >
                  <Settings2 className="h-4 w-4" aria-hidden="true" />
                  {configure ? "Fechar configuração" : "Conexões"}
                </Button>
              )}
            </div>
          </div>
          <div className="relative mt-5 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
            {operacao && (
              <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                CRM atualizado {date(operacao.atualizado_em)}
              </span>
            )}
            <span
              className={
                "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium " +
                (state?.configured
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground")
              }
            >
              <span
                className={
                  "h-1.5 w-1.5 rounded-full " +
                  (state?.configured ? "bg-emerald-500" : "bg-muted-foreground/50")
                }
                aria-hidden="true"
              />
              {state?.configured ? "Financeiro conectado" : "Financeiro a verificar"}
            </span>
            {operacao && prontidaoConhecida > 0 && (
              <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                {prontidaoOk}/{prontidaoConhecida} integrações prontas
              </span>
            )}
          </div>
          <nav
            aria-label="Acesso rápido"
            className="relative mt-4 flex flex-wrap gap-2 border-t border-border/50 pt-4"
          >
            {atalhosOperacionais.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/60 bg-background/65 px-2.5 text-[11px] font-semibold text-muted-foreground backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground"
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>
        </header>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-destructive/25 bg-destructive/[0.045] p-4 text-sm"
          >
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
              aria-hidden="true"
            />
            <div>
              <p className="font-medium">{error}</p>
              {dashboard && (
                <p className="mt-1 text-muted-foreground">
                  A atualização falhou. Os dados anteriores continuam disponíveis abaixo.
                </p>
              )}
            </div>
          </div>
        )}
        {notice && (
          <div
            role="status"
            className="flex items-start gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.045] p-4 text-sm"
          >
            <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
            <p>{notice}</p>
          </div>
        )}
        {loading && !state && !operacao && (
          <div
            role="status"
            aria-label="Carregando visão geral"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            {[0, 1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-36 animate-pulse rounded-2xl border border-border/70 bg-muted/40"
              />
            ))}
          </div>
        )}

        {operacao && (
          <section
            aria-label="Prioridades de hoje"
            className={
              "grid overflow-hidden rounded-2xl border md:grid-cols-[1fr_auto] " +
              (atencaoOperacional && atencaoOperacional > 0
                ? "border-amber-500/20 bg-amber-500/[0.035]"
                : "border-emerald-500/20 bg-emerald-500/[0.025]")
            }
          >
            <div className="flex min-w-0 items-start gap-3 px-4 py-4 sm:px-5">
              <span
                className={
                  "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl " +
                  (atencaoOperacional && atencaoOperacional > 0
                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300")
                }
                aria-hidden="true"
              >
                {atencaoOperacional && atencaoOperacional > 0 ? (
                  <AlertTriangle className="h-4 w-4" />
                ) : (
                  <BadgeCheck className="h-4 w-4" />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                  Prioridade de hoje
                </p>
                <p className="mt-1 text-sm font-semibold tracking-tight">
                  {atencaoOperacional && atencaoOperacional > 0
                    ? atencaoOperacional + " item(ns) precisam de atenção"
                    : "Nenhuma pendência crítica detectada"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {operacao.aguardando_atendimento} conversa(s) aguardando atendimento ·{" "}
                  {operacao.tarefas_atrasadas} tarefa(s) atrasada(s).
                </p>
              </div>
            </div>
            <div className="flex items-center border-t border-border/50 px-4 py-3 md:border-t-0 md:border-l md:px-5">
              <Link
                href={operacao.aguardando_atendimento > 0 ? "/app/inbox" : "/app/tasks"}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground transition-colors hover:text-primary"
              >
                Abrir prioridades <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          </section>
        )}

        <section
          aria-label="Visão geral"
          className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm"
        >
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border/60 px-5 py-4 sm:px-6">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                Agora
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight">Visão geral</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Primeiro os valores e contratos; depois o que exige ação da equipe.
              </p>
            </div>
            {dashboard && (
              <p className="text-xs text-muted-foreground">
                Financeiro consultado em {date(dashboard.fetched_at)}
              </p>
            )}
          </div>

          <div className="p-5 sm:p-6">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric
                title="Receita recorrente mensal"
                value={mrrTotal === null ? "—" : currency(mrrTotal)}
                note={
                  stripe && other
                    ? "Stripe " +
                      currency(stripe.mrr_cents) +
                      " + PIX/manual " +
                      currency(other.mrr_cents) +
                      "."
                    : "Aguardando as fontes financeiras disponíveis."
                }
                icon={WalletCards}
                tone="accent"
              />
              <Metric
                title="Vendas do mês"
                value={vendasMesTotal === null ? "—" : currency(vendasMesTotal)}
                note={
                  stripe || other
                    ? "Soma do que as fontes disponíveis confirmam para o mês corrente."
                    : "Sem fonte financeira disponível nesta consulta."
                }
                icon={CircleDollarSign}
                tone="success"
              />
              <Metric
                title="Contratos ativos"
                value={contratosAtivos === null ? "—" : contratosAtivos}
                note={
                  stripe && other
                    ? stripe.active_subscriptions +
                      " no Stripe + " +
                      other.subscriptions.filter((row) => row.status === "active").length +
                      " no PIX/manual."
                    : "Conecte ou atualize as fontes para consolidar os contratos."
                }
                icon={CreditCard}
              />
              <Metric
                title="Clientes em atraso"
                value={atrasosFinanceiros === null ? "—" : atrasosFinanceiros}
                note={
                  stripe && other
                    ? stripe.past_due_count +
                      " no Stripe + " +
                      other.past_due_customers +
                      " no PIX/manual."
                    : "Aguardando consolidação das fontes."
                }
                icon={AlertTriangle}
                tone={atrasosFinanceiros && atrasosFinanceiros > 0 ? "warning" : "default"}
              />
            </div>

            <div className="my-6 h-px bg-border/60" />

            {erroOperacao ? (
              <p
                role="alert"
                className="rounded-xl border border-destructive/25 bg-destructive/[0.035] p-4 text-sm"
              >
                {erroOperacao}
              </p>
            ) : operacao ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric
                    title="Negócios abertos"
                    value={operacao.negocios_abertos}
                    note={operacao.contatos + " contato(s) cadastrados no CRM."}
                    icon={Target}
                  />
                  <Metric
                    title="Aguardando atendimento"
                    value={operacao.aguardando_atendimento}
                    note="Conversas abertas que ainda dependem de ação humana."
                    icon={MessageCircleMore}
                    tone={operacao.aguardando_atendimento > 0 ? "warning" : "default"}
                  />
                  <Metric
                    title="Tarefas"
                    value={operacao.tarefas_abertas}
                    note={operacao.tarefas_atrasadas + " atrasada(s) precisam de atenção."}
                    icon={BadgeCheck}
                    tone={operacao.tarefas_atrasadas > 0 ? "warning" : "default"}
                  />
                  <Metric
                    title="Agenda · 30 dias"
                    value={operacao.compromissos_30d}
                    note="Compromissos pendentes ou confirmados nos próximos 30 dias."
                    icon={CalendarDays}
                  />
                </div>
              </>
            ) : (
              <div role="status" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[0, 1, 2, 3].map((item) => (
                  <div key={item} className="h-32 animate-pulse rounded-2xl bg-muted/45" />
                ))}
              </div>
            )}
          </div>
        </section>

        {operacao && (
          <details
            aria-label="Prontidão da operação"
            className="group overflow-hidden rounded-2xl border border-border/70 bg-muted/[0.14]"
          >
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
                  aria-hidden="true"
                >
                  <Activity className="h-4 w-4" strokeWidth={1.8} />
                </span>
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                    Infraestrutura operacional
                  </p>
                  <h2 className="mt-1 text-lg font-semibold tracking-tight">
                    Prontidão da operação
                  </h2>
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                    Conexões essenciais para a PeríciaIA operar sem depender de ajustes manuais.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {prontidaoConhecida > 0 && (
                  <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                    {prontidaoOk}/{prontidaoConhecida} prontas
                  </span>
                )}
                <ArrowRight
                  className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90"
                  aria-hidden="true"
                />
              </div>
            </summary>
            <div className="grid gap-3 border-t border-border/60 p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-3">
              <ReadinessCard
                title="Responsáveis"
                ready={
                  operacao.prontidao.responsaveis_ativos === null
                    ? null
                    : operacao.prontidao.responsaveis_ativos > 0
                }
                detail={
                  operacao.prontidao.responsaveis_ativos === null
                    ? "Não foi possível conferir a equipe."
                    : `${operacao.prontidao.responsaveis_ativos} responsável(is) apto(s) a receber negócios e atendimentos.`
                }
                href="/app/team"
                icon={UsersRound}
              />
              <ReadinessCard
                title="Agenda Google"
                ready={
                  operacao.prontidao.agenda_google.saudaveis === null
                    ? null
                    : operacao.prontidao.agenda_google.saudaveis > 0
                }
                detail={
                  operacao.prontidao.agenda_google.total === null
                    ? "Não foi possível conferir as contas conectadas."
                    : `${operacao.prontidao.agenda_google.saudaveis ?? 0} saudável(is) de ${operacao.prontidao.agenda_google.total} conexão(ões).`
                }
                href="/app/agenda"
                icon={CalendarDays}
              />
              <ReadinessCard
                title="WhatsApp"
                ready={
                  operacao.prontidao.whatsapp.conectados === null
                    ? null
                    : operacao.prontidao.whatsapp.conectados > 0
                }
                detail={
                  operacao.prontidao.whatsapp.total === null
                    ? "Não foi possível conferir os canais."
                    : `${operacao.prontidao.whatsapp.conectados ?? 0} conectado(s) de ${operacao.prontidao.whatsapp.total} canal(is).`
                }
                href="/app/connections"
                icon={MessageCircleMore}
              />
              <ReadinessCard
                title="Inteligência artificial"
                ready={
                  operacao.prontidao.inteligencia_artificial.validadas === null
                    ? null
                    : operacao.prontidao.inteligencia_artificial.validadas > 0
                }
                detail={
                  operacao.prontidao.inteligencia_artificial.credenciais_ativas === null
                    ? "Não foi possível conferir as credenciais."
                    : `${operacao.prontidao.inteligencia_artificial.validadas ?? 0} validada(s) de ${operacao.prontidao.inteligencia_artificial.credenciais_ativas} credencial(is) ativa(s).`
                }
                href="/app/ai/credentials"
                icon={Sparkles}
              />
              <ReadinessCard
                title="Meta Ads"
                ready={operacao.prontidao.meta_ads.conectada}
                detail={
                  operacao.prontidao.meta_ads.conectada === null
                    ? "Não foi possível conferir a conexão de leitura."
                    : operacao.prontidao.meta_ads.conectada
                      ? "Token de leitura conectado para alimentar os indicadores do Dashboard."
                      : "Falta conectar o token de leitura da conta de anúncios."
                }
                href="/app/settings/meta-ads"
                icon={Megaphone}
              />
              <ReadinessCard
                title="Cobrança e contratos"
                ready={state === null ? null : state.configured}
                detail={
                  state === null
                    ? "Conferindo a integração financeira."
                    : state.configured
                      ? "Fonte financeira conectada ao Dashboard."
                      : "Integração financeira ainda não configurada para esta organização."
                }
                href="/app/assinaturas"
                icon={CreditCard}
              />
            </div>
          </details>
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
            <details className="group rounded-2xl border border-border/70 bg-muted/[0.18]">
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-sm font-medium">
                <span className="inline-flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Como os totais financeiros são calculados
                </span>
                <span className="inline-flex items-center gap-2 text-xs font-normal text-muted-foreground">
                  Somente consulta
                  <ArrowRight
                    className="h-3.5 w-3.5 transition-transform group-open:rotate-90"
                    aria-hidden="true"
                  />
                </span>
              </summary>
              <div className="border-t border-border/60 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                As fontes usam unidades diferentes:{" "}
                <strong className="text-foreground">assinaturas no Stripe</strong> e{" "}
                <strong className="text-foreground">clientes no PIX/manual</strong>. Os totais
                consolidados combinam o que cada fonte confirma; os detalhes por fonte ficam
                disponíveis mais abaixo para auditoria, sem ocupar o foco principal.
              </div>
            </details>
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
              <section
                aria-label="Fluxo financeiro"
                className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6"
              >
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                      Caixa e próximos recebimentos
                    </p>
                    <h2 className="mt-1 text-lg font-semibold tracking-tight">Fluxo financeiro</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      O que entrou hoje e o que já está previsto para os próximos 30 dias.
                    </p>
                  </div>
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    aria-hidden="true"
                  >
                    <CircleDollarSign className="h-4 w-4" strokeWidth={1.8} />
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {other && (
                    <Metric
                      title="Recebido hoje · PIX/manual"
                      value={currency(other.vendas_hoje_cents)}
                      note={other.vendas_hoje_count + " pagamento(s) confirmado(s) hoje."}
                      icon={CircleDollarSign}
                      tone="success"
                    />
                  )}
                  {stripe && (
                    <Metric
                      title="Stripe hoje · amostra"
                      value={currency(stripe.vendas_hoje_amostra_cents)}
                      note={
                        stripe.vendas_hoje_amostra_count +
                        " pagamento(s) entre os 5 mais recentes enviados pela fonte."
                      }
                      icon={CreditCard}
                    />
                  )}
                  {other && (
                    <Metric
                      title="A receber · 30 dias"
                      value={currency(other.a_receber_30d_cents)}
                      note={
                        other.a_receber_30d_count + " renovação(ões) prevista(s) em PIX/manual."
                      }
                      icon={Clock3}
                      tone="accent"
                    />
                  )}
                  {stripe && (
                    <Metric
                      title="Renovações · 30 dias"
                      value={stripe.renovacoes_30d_count}
                      note="A Stripe envia a contagem e as datas, mas não o valor de cada renovação."
                      icon={RefreshCw}
                    />
                  )}
                </div>
              </section>
            )}

            <section
              aria-label="Aquisição e conversão"
              className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 px-5 py-4 sm:px-6">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
                    aria-hidden="true"
                  >
                    <Megaphone className="h-4 w-4" strokeWidth={1.8} />
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                      Aquisição
                    </p>
                    <h2 className="mt-0.5 text-lg font-semibold tracking-tight">
                      Meta Ads → resultado no CRM
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Últimos 30 dias completos, com atribuição somente quando o vínculo é
                      comprovado.
                    </p>
                  </div>
                </div>
                <Button asChild variant="outline" size="sm" className="gap-2">
                  <Link href="/app/ads/meta">
                    Ver campanhas <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </Button>
              </div>

              <div className="p-5 sm:p-6">
                {meta ? (
                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-xl border border-border/60 bg-muted/[0.18] p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">Mídia</p>
                          <p className="text-xs text-muted-foreground">
                            O que a conta de anúncios entregou.
                          </p>
                        </div>
                        <Badge variant="outline">Meta Ads</Badge>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Metric
                          title="Investimento"
                          value={meta.gasto.toLocaleString("pt-BR", {
                            style: "currency",
                            currency: meta.moeda,
                          })}
                          note={meta.periodo}
                          icon={WalletCards}
                        />
                        <Metric
                          title="Conversas iniciadas"
                          value={meta.conversas}
                          note="Resultado atribuído pela Meta às campanhas de mensagens."
                          icon={MessageCircleMore}
                        />
                        <Metric
                          title="Custo por conversa"
                          value={
                            meta.custoPorConversa === null
                              ? "—"
                              : meta.custoPorConversa.toLocaleString("pt-BR", {
                                  style: "currency",
                                  currency: meta.moeda,
                                })
                          }
                          note="Investimento dividido pelas conversas iniciadas."
                          icon={Target}
                        />
                        <Metric
                          title="Campanhas ativas"
                          value={meta.campanhasAtivas}
                          note="Campanhas com veiculação ativa na conta consultada."
                          icon={Activity}
                        />
                      </div>
                    </div>

                    <div className="rounded-xl border border-primary/15 bg-primary/[0.025] p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">Resultado comprovado</p>
                          <p className="text-xs text-muted-foreground">
                            O que realmente virou oportunidade e venda no CRM.
                          </p>
                        </div>
                        <Badge variant="outline">CRM</Badge>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Metric
                          title="Oportunidades atribuídas"
                          value={operacao?.meta_atribuicao_30d.oportunidades ?? "—"}
                          note="Negócios com clique Meta comprovado no período."
                          icon={Target}
                          tone="accent"
                        />
                        <Metric
                          title="Vendas atribuídas"
                          value={operacao?.meta_atribuicao_30d.vendas ?? "—"}
                          note="Negócios ganhos com atribuição comprovada."
                          icon={BadgeCheck}
                          tone="success"
                        />
                        <Metric
                          title="Receita atribuída"
                          value={
                            operacao
                              ? currency(
                                  operacao.meta_atribuicao_30d.receita_cents,
                                  operacao.meta_atribuicao_30d.moeda,
                                )
                              : "—"
                          }
                          note="Somente vendas atribuídas à Meta e com valor registrado."
                          icon={CircleDollarSign}
                          tone="success"
                        />
                        <Metric
                          title="ROAS atribuído"
                          value={
                            operacao &&
                            meta.gasto > 0 &&
                            operacao.meta_atribuicao_30d.receita_cents > 0
                              ? (
                                  operacao.meta_atribuicao_30d.receita_cents /
                                  100 /
                                  meta.gasto
                                ).toLocaleString("pt-BR", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                }) + "x"
                              : "—"
                          }
                          note="Receita atribuída dividida pelo investimento comprovado."
                          icon={TrendingUp}
                          tone="accent"
                        />
                      </div>
                    </div>
                  </div>
                ) : erroMeta ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/[0.2] p-4 text-sm">
                    <span className="text-muted-foreground">{erroMeta}</span>
                    <Link
                      className="inline-flex items-center gap-1.5 font-semibold hover:text-primary"
                      href="/app/settings/meta-ads"
                    >
                      Configurar Meta Ads <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {[0, 1, 2, 3].map((item) => (
                      <div key={item} className="h-32 animate-pulse rounded-2xl bg-muted/45" />
                    ))}
                  </div>
                )}
                <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                  Venda sem identificador de clique comprovado não entra na atribuição nem no ROAS.
                </p>
              </div>
            </section>

            {stripe && <DashboardCharts stripe={stripe} />}

            {(stripe || other) && (
              <details className="group overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
                      aria-hidden="true"
                    >
                      <CreditCard className="h-4 w-4" strokeWidth={1.8} />
                    </span>
                    <div>
                      <p className="text-sm font-semibold">Detalhes por fonte financeira</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Auditoria de Stripe, PIX/manual, planos e histórico mensal.
                      </p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    Ver detalhes
                    <ArrowRight
                      className="h-3.5 w-3.5 transition-transform group-open:rotate-90"
                      aria-hidden="true"
                    />
                  </span>
                </summary>

                <div className="space-y-6 border-t border-border/60 p-5 sm:p-6">
                  {stripe && (
                    <section
                      aria-label="Indicadores Stripe"
                      className="rounded-xl border border-border/60 bg-muted/[0.14] p-4 sm:p-5"
                    >
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">Stripe</h3>
                          {stripe.verificado_direto ? (
                            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                              Verificado direto
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
                        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 text-xs leading-relaxed">
                          <AlertTriangle
                            className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300"
                            aria-hidden="true"
                          />
                          <p>
                            O resumo do admin já apresentou divergência na contagem de assinaturas
                            ativas. Enquanto não houver verificação direta, trate essa contagem como
                            dado da fonte, não como clientes únicos.
                          </p>
                        </div>
                      )}

                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <Metric
                          title="Assinaturas ativas"
                          value={stripe.active_subscriptions}
                          note={
                            stripe.verificado_direto
                              ? "Contagem paginada direto na Stripe."
                              : "Contagem informada pela fonte."
                          }
                          icon={CreditCard}
                        />
                        <Metric
                          title="Receita recorrente mensal"
                          value={currency(stripe.mrr_cents)}
                          note={
                            stripe.verificado_direto
                              ? "MRR calculado sobre assinaturas ativas verificadas."
                              : "MRR informado pela fonte."
                          }
                          icon={WalletCards}
                          tone="accent"
                        />
                        <Metric
                          title="Em atraso"
                          value={stripe.past_due_count}
                          note="Assinaturas em situação past_due informadas pela Stripe."
                          icon={AlertTriangle}
                          tone={stripe.past_due_count > 0 ? "warning" : "default"}
                        />
                        <Metric
                          title="Receita recorrente anual"
                          value={currency(stripe.arr_cents)}
                          note="ARR informado pela fonte Stripe."
                          icon={TrendingUp}
                        />
                        <Metric
                          title="Churn · 90 dias"
                          value={stripe.churn_rate_90d + "%"}
                          note={stripe.churned_90d + " cancelamento(s) no período."}
                          icon={Activity}
                        />
                        <Metric
                          title="Cancelamento programado"
                          value={stripe.canceling_count}
                          note="Assinaturas com cancelamento ao fim do período."
                          icon={Clock3}
                          tone={stripe.canceling_count > 0 ? "warning" : "default"}
                        />
                      </div>

                      <div className="mt-4 grid gap-4 lg:grid-cols-2">
                        <div className="rounded-xl border border-border/60 bg-card p-4">
                          <h4 className="text-sm font-semibold">Histórico mensal</h4>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Valores recebidos informados pela Stripe.
                          </p>
                          <div className="mt-4 space-y-3">
                            {stripe.monthly_revenue.length === 0 ? (
                              <Empty>Sem histórico informado.</Empty>
                            ) : (
                              stripe.monthly_revenue.slice(-12).map((row) => (
                                <div
                                  key={row.month}
                                  className="grid grid-cols-[4.5rem_minmax(0,1fr)_6.5rem] items-center gap-2 text-xs"
                                >
                                  <span className="text-muted-foreground">{row.month}</span>
                                  <div
                                    className="h-2 overflow-hidden rounded-full bg-muted"
                                    aria-hidden="true"
                                  >
                                    <div
                                      className="h-full rounded-full bg-primary"
                                      style={{
                                        width:
                                          (Math.abs(row.revenue_cents) / maxRevenue) * 100 + "%",
                                      }}
                                    />
                                  </div>
                                  <span className="text-right font-medium tabular-nums">
                                    {currency(row.revenue_cents)}
                                  </span>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        <div className="rounded-xl border border-border/60 bg-card p-4">
                          <h4 className="text-sm font-semibold">Planos</h4>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Distribuição e MRR conforme o cadastro financeiro.
                          </p>
                          <div className="mt-2 divide-y divide-border/60">
                            {stripe.plans.length ? (
                              stripe.plans.map((row) => (
                                <div
                                  key={row.name}
                                  className="flex items-center justify-between gap-4 py-3"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium">{row.name}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {row.count} assinatura(s)
                                    </p>
                                  </div>
                                  <p className="shrink-0 text-sm font-semibold tabular-nums">
                                    {currency(row.mrr_cents)}
                                  </p>
                                </div>
                              ))
                            ) : (
                              <Empty>Sem planos informados.</Empty>
                            )}
                          </div>
                        </div>
                      </div>
                    </section>
                  )}

                  {other && (
                    <section
                      aria-label="Indicadores PIX e manual"
                      className="rounded-xl border border-border/60 bg-muted/[0.14] p-4 sm:p-5"
                    >
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="font-semibold">PIX e registros manuais</h3>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Clientes e recorrência fora da Stripe.
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Fonte gerada em {date(other.generated_at)}
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <Metric
                          title="Clientes ativos"
                          value={other.active_customers}
                          note={
                            other.customer_count + " cadastro(s) na exportação, incluindo inativos."
                          }
                          icon={UsersRound}
                        />
                        <Metric
                          title="Receita recorrente mensal"
                          value={currency(other.mrr_cents)}
                          note="Ciclos semestrais e anuais já mensalizados pela fonte."
                          icon={WalletCards}
                          tone="accent"
                        />
                        <Metric
                          title="Clientes em atraso"
                          value={other.past_due_customers}
                          note={"MRR em risco: " + currency(other.mrr_at_risk_cents) + "."}
                          icon={AlertTriangle}
                          tone={other.past_due_customers > 0 ? "warning" : "default"}
                        />
                      </div>
                    </section>
                  )}
                </div>
              </details>
            )}

            <Section
              title="Atenção à carteira"
              description="Priorize retenção, pagamentos pendentes e próximas renovações sem misturar essa análise com o resumo executivo."
            >
              <div
                className="mb-5 inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-border/70 bg-muted/45 p-1"
                role="group"
                aria-label="Tipo de registro"
              >
                {(
                  [
                    ["subscriptions", "Clientes e assinaturas"],
                    ["payments", "Pagamentos"],
                    ["renewals", "Renovações Stripe"],
                  ] as const
                ).map(([key, title]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    aria-pressed={tab === key}
                    className={
                      "rounded-lg px-3 py-2 text-xs font-semibold transition-colors " +
                      (tab === key
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-background/70 hover:text-foreground")
                    }
                  >
                    {title}
                  </button>
                ))}
              </div>
              {tab === "subscriptions" && (
                <>
                  {stripe && (
                    <div
                      className={
                        "mb-6 rounded-xl border p-4 " +
                        (stripe.past_due_count > 0
                          ? "border-amber-500/20 bg-amber-500/[0.045]"
                          : "border-emerald-500/20 bg-emerald-500/[0.035]")
                      }
                    >
                      <div className="flex items-center gap-2">
                        {stripe.past_due_count > 0 ? (
                          <AlertTriangle
                            className="h-4 w-4 text-amber-600 dark:text-amber-300"
                            aria-hidden="true"
                          />
                        ) : (
                          <BadgeCheck
                            className="h-4 w-4 text-emerald-600 dark:text-emerald-300"
                            aria-hidden="true"
                          />
                        )}
                        <h3 className="text-sm font-semibold">
                          Em atraso · Stripe ({stripe.past_due_count})
                        </h3>
                      </div>
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
            <footer className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-muted/[0.16] p-3">
              <Link
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                href="/app/contacts"
              >
                <UsersRound className="h-3.5 w-3.5" aria-hidden="true" />
                Contatos
              </Link>
              <Link
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                href="/app/kanban"
              >
                <Target className="h-3.5 w-3.5" aria-hidden="true" />
                Funil comercial
              </Link>
              <Link
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                href="/app/audit"
              >
                <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                Auditoria
              </Link>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
