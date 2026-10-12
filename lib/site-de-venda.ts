/**
 * A raiz (`/`) mostra o site de venda do Gravity CRM só nos domínios de venda;
 * em todo o resto (ex.: periciaia.vercel.app) continua indo direto ao painel,
 * como sempre foi. A lista vem de `SITE_DE_VENDA_HOSTS` (separada por vírgula).
 */
export function hostDoSiteDeVenda(host: string | null | undefined, lista: string | null | undefined): boolean {
  const alvo = String(host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (!alvo) return false;
  return String(lista ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, ""))
    .filter(Boolean)
    .some((h) => h === alvo);
}
