"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { BillingDashboard, BillingSourceError } from "@/lib/billing-export/contracts";

type State = { configured: boolean; dashboard: BillingDashboard | null };
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
              Clientes e assinaturas
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Acompanhe a receita recorrente e identifique quem precisa de atenção.
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
          <p role="status" className="py-12 text-center text-sm text-muted-foreground">
            Consultando clientes e assinaturas…
          </p>
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
              <strong>clientes no PIX/manual</strong>. Os números são apresentados separadamente,
              pois a API do Stripe não fornece o cadastro completo para deduplicar clientes entre as
              fontes.
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

            {stripe && (
              <section aria-label="Indicadores Stripe">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold">Stripe</h2>
                  <p className="text-xs text-muted-foreground">
                    Fonte gerada em {date(stripe.generated_at)}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Metric
                    title="Assinaturas ativas"
                    value={stripe.active_subscriptions}
                    note="Contagem informada pelo Stripe; não representa clientes únicos."
                  />
                  <Metric
                    title="Receita recorrente mensal"
                    value={currency(stripe.mrr_cents)}
                    note="MRR informado pela fonte. Não equivale ao caixa recebido no mês."
                  />
                  <Metric
                    title="Em atraso"
                    value={stripe.past_due_count}
                    note="Contagem past_due informada pelo Stripe. Veja a lista de atenção abaixo."
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
