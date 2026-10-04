import { notFound } from "next/navigation";

import { Card } from "@/components/ui/card";
import { loadAuthUser } from "@/lib/auth/server";
import { estadoTokenPje } from "@/lib/pje/config";
import { estadoPontePje } from "@/lib/pje/legacy-admin";

import { FormularioTokenPje } from "./_form";

export const metadata = { title: "PJe — credencial global" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const usuario = await loadAuthUser();
  if (!usuario?.is_platform_admin) notFound();

  const [estado, ponte] = await Promise.all([
    estadoTokenPje(),
    estadoPontePje(),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Integração da instalação
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">PJe</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Gerencie o Token Ouro usado pela operação de processos. Você atualiza
          uma vez; o CRM guarda uma única fonte de verdade e mantém o PeríciaIA
          atual sincronizado enquanto o backend antigo ainda atende os clientes.
        </p>
      </div>

      <Card className="p-5 sm:p-6">
        <FormularioTokenPje
          configuradoInicial={estado.configurado}
          last4Inicial={estado.last4}
          ponteConfiguradaInicial={ponte.configurada}
          emailLegadoInicial={ponte.email}
        />
      </Card>

      <Card className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span
            className="mt-1 size-2 shrink-0 rounded-full bg-amber-500"
            aria-hidden
          />
          <div>
            <h2 className="text-sm font-semibold">
              Migração sem interromper os clientes
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Enquanto o PeríciaIA antigo ainda executa a importação dos
              processos, esta tela mantém o Token Ouro sincronizado com ele pela
              ponte administrativa. Depois que o backend antigo for substituído,
              a mesma credencial global continuará sendo a fonte de verdade, sem
              mudar seu fluxo diário.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
