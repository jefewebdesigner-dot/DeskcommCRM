import { Hero } from "@/components/marketing/Hero";
import { WhyNotChatbot } from "@/components/marketing/WhyNotChatbot";
import { Pillars } from "@/components/marketing/Pillars";
import { Segments } from "@/components/marketing/Segments";
import { Comparison } from "@/components/marketing/Comparison";
import { Pricing } from "@/components/marketing/Pricing";
import { DemoForm } from "@/components/marketing/DemoForm";
import { FAQ } from "@/components/marketing/FAQ";
import { SiteFooter } from "@/components/marketing/SiteFooter";

// Site de venda do Gravity CRM (veio do crm.ia na fusão). Só aparece nos
// domínios de SITE_DE_VENDA_HOSTS — ver app/page.tsx e lib/site-de-venda.ts.
// Sem depoimentos: os do site antigo eram fictícios; entram quando houver
// cliente real que autorize.
export function SiteDeVenda({ destinoDoFormulario }: { destinoDoFormulario: string }) {
  return (
    <div className="mkt-page">
      <Hero />
      <main>
        <WhyNotChatbot />
        <Pillars />
        <Segments />
        <Comparison />
        <Pricing />
        <DemoForm destino={destinoDoFormulario} />
        <FAQ />
        <SiteFooter />
      </main>
    </div>
  );
}
