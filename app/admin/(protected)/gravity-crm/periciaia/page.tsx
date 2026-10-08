import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { loadAuthUser } from "@/lib/auth/server";
import { loadPericiaiaCutoverStatus } from "@/lib/vertical-packs/periciaia-cutover";

export const metadata = { title: "PeríciaIA → Gravity CRM" };
export const dynamic = "force-dynamic";

export default async function PericiaIACutoverPage() {
  const user = await loadAuthUser();
  if (!user?.is_platform_admin) notFound();

  const status = await loadPericiaiaCutoverStatus().catch(() => null);

  if (!status) {
    return (
      <div className="mx-auto w-full max-w-5xl p-4 sm:p-6 lg:p-8">
        <Card className="p-6">
          <Badge variant="warning">Fusão em preparação</Badge>
          <h1 className="mt-3 text-2xl font-semibold">
            PeríciaIA → Gravity CRM
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            O código da fusão está instalado, mas o banco ainda não expõe todos
            os artefatos do SaaS Core. Aplique as migrations pendentes antes de
            medir o cutover.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status.blockingReady ? "success" : "warning"}>
            {status.blockingReady ? "Pronto para validação final" : "Em transição"}
          </Badge>
          <Badge variant="neutral">{status.progress}% dos sinais verdes</Badge>
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Fusão PeríciaIA → Gravity CRM
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          A fusão acontece sobre a organização existente. Este painel não cria
          cliente, tenant ou assinatura: apenas prova que o mesmo histórico já
          está reconciliado no novo Core.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Contatos atuais", status.totals.contacts],
          ["Clientes financeiros", status.totals.eligibleContacts],
          ["Contas Customer 360", status.totals.saasAccounts],
          ["Assinaturas no Revenue OS", status.totals.actualRevenueStates],
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
          </Card>
        ))}
      </section>

      <Card className="overflow-hidden">
        <div className="border-b p-5">
          <h2 className="font-semibold">Critérios de cutover</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Nenhum critério bloqueante pode ser ignorado para declarar a fusão
            ativa.
          </p>
        </div>
        <div className="divide-y">
          {status.checks.map((check) => (
            <div
              key={check.id}
              className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">{check.label}</p>
                  {check.blocking ? (
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      bloqueante
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {check.detail}
                </p>
              </div>
              <Badge variant={check.ok ? "success" : "warning"}>
                {check.ok ? "OK" : "Pendente"}
              </Badge>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold">Regra da fusão</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          O status só poderá sair de <code>transitioning</code> depois que os
          clientes financeiros existentes estiverem ligados ao Customer 360,
          as identidades baterem com o billing, as assinaturas estiverem no
          Revenue OS e a operação PJe estiver preservada. O domínio judicial
          continua no produto PeríciaIA; o Gravity CRM assume relacionamento,
          receita, suporte, Customer Success e retenção.
        </p>
      </Card>
    </div>
  );
}
