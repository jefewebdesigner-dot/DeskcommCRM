"use client";
import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { SourcesTab } from "./SourcesTab";
import { RulesTab } from "./RulesTab";
import { ActivityTab } from "./ActivityTab";
import { CapturasTab } from "./CapturasTab";
import { useT } from "@/hooks/i18n/useT";

export function WebhooksClient() {
  const t = useT();
  // Radix Tabs gera ids via useId; com SSR streamado (Next 15) os ids divergem
  // entre server e client e o React acusa hydration mismatch. Nenhuma outra
  // página do app SSRa Tabs no primeiro paint (todas montam pós-fetch) —
  // seguimos o mesmo padrão: skeleton no SSR, Tabs após mount.
  const mounted = React.useSyncExternalStore(
    React.useCallback(() => () => {}, []),
    () => true,
    () => false,
  );

  if (!mounted) {
    // Mesma altura do TabsList (h-9) e largura MEDIDA da tablist — zero layout
    // shift. 432px é a medida com QUATRO abas (`getBoundingClientRect` em
    // 1440px, aba "Leads recebidos" incluída); eram 306px com três, e um
    // skeleton estreito demais faz a página saltar no primeiro paint.
    // Ao acrescentar ou renomear aba, MEDIR de novo — este número não se
    // estima a olho.
    return (
      <div className="flex-1">
        <Skeleton className="h-9 w-full max-w-[432px] rounded-xl" />
      </div>
    );
  }

  return (
    <Tabs defaultValue="sources" className="flex-1">
      <TabsList className="h-10 w-full justify-start overflow-x-auto rounded-xl border border-border/50 bg-card p-1 shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <TabsTrigger value="sources" className="shrink-0 rounded-lg px-4 text-xs">
          {t("Receber dados")}
        </TabsTrigger>
        <TabsTrigger value="capturas" className="shrink-0">{t("Leads recebidos")}</TabsTrigger>
        <TabsTrigger value="rules" className="shrink-0 rounded-lg px-4 text-xs">
          {t("Automações")}
        </TabsTrigger>
        <TabsTrigger value="activity" className="shrink-0 rounded-lg px-4 text-xs">
          {t("Atividade")}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="sources">
        <SourcesTab />
      </TabsContent>
      <TabsContent value="capturas">
        <CapturasTab />
      </TabsContent>
      <TabsContent value="rules">
        <RulesTab />
      </TabsContent>
      <TabsContent value="activity">
        <ActivityTab />
      </TabsContent>
    </Tabs>
  );
}
