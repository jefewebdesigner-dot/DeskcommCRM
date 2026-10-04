import { notFound } from "next/navigation";

import { Card } from "@/components/ui/card";
import { loadAuthUser } from "@/lib/auth/server";
import { estadoTokenPje } from "@/lib/pje/config";

import { FormularioTokenPje } from "./_form";

export const metadata = { title: "PJe — credencial global" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const usuario = await loadAuthUser();
  if (!usuario?.is_platform_admin) notFound();

  const estado = await estadoTokenPje();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Integração da instalação
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">PJe</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Gerencie a credencial global usada pela operação de processos. Você atualiza uma vez; o backend da instalação passa a ter uma única fonte de verdade para todos os clientes.
        </p>
      </div>

      <Card className="p-5 sm:p-6">
        <FormularioTokenPje
          configuradoInicial={estado.configurado}
          last4Inicial={estado.last4}
        />
      </Card>

      <Card className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="mt-1 size-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
          <div>
            <h2 className="text-sm font-semibold">Migração em duas etapas</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              A credencial central e segura já fica pronta nesta etapa. O adaptador que consulta/importa processos e documentos do PJe será ligado a esta mesma credencial na etapa seguinte. Até isso acontecer, esta tela não promete uma importação que ainda não foi portada do sistema antigo.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
