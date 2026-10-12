import { headers } from "next/headers";
import { redirect } from "next/navigation";

import "./marketing.css";
import { SiteDeVenda } from "@/components/marketing/SiteDeVenda";
import { env } from "@/lib/env";
import { hostDoSiteDeVenda } from "@/lib/site-de-venda";

// A raiz mostra o site de venda do Gravity CRM só nos domínios de venda
// (SITE_DE_VENDA_HOSTS). Em todo o resto — a instalação da PeríciaIA, por
// exemplo — continua indo direto ao painel, e o middleware manda quem não
// está logado para /login?next=/app, como sempre.
export default async function HomePage() {
  const host = (await headers()).get("host");
  if (hostDoSiteDeVenda(host, env.SITE_DE_VENDA_HOSTS)) {
    return <SiteDeVenda destinoDoFormulario={env.SITE_DE_VENDA_FORM_URL} />;
  }
  redirect("/app");
}
