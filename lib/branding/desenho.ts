/**
 * Geometria da marca padrão do Gravity CRM.
 *
 * O símbolo é um "G" orbital simples, sem depender de fonte ou arquivo externo.
 * O nome completo é renderizado pelo componente com o valor resolvido da marca,
 * então uma instalação white-label nunca recebe texto fixo do produto.
 */
export const SIMBOLO = {
  viewBox: "0 0 64 64",
  transform: "translate(0 0)",
  d: "M50 18A22 22 0 1 0 52 44V32H35",
  strokeWidth: 7,
} as const;

export const LOGOTIPO = {
  viewBox: "0 0 310 64",
  proporcao: 310 / 64,
  simbolo: {
    transform: "translate(2 2) scale(0.94)",
    d: SIMBOLO.d,
    strokeWidth: SIMBOLO.strokeWidth,
  },
} as const;

/**
 * Mantemos a régua já aprovada do produto; só a geometria/nome mudou.
 * Símbolo em sálvia, nome em neutro forte e "CRM" em neutro secundário.
 */
export const CORES_DA_MARCA = {
  claro: { simbolo: "#506d48", nome: "#1c1a16", sufixo: "#5d594f" },
  escuro: { simbolo: "#82a077", nome: "#f5f4ef", sufixo: "#8e8b7f" },
} as const;
