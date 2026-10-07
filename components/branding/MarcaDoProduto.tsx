import { LOGOTIPO, SIMBOLO } from "@/lib/branding/desenho";
import { cn } from "@/lib/utils";

type Props = {
  readonly nome: string;
  readonly className?: string;
  readonly decorativo?: boolean;
};

const SIMBOLO_CLARO_ESCURO = "stroke-[#506d48] dark:stroke-[#82a077]";
const NOME_CLARO_ESCURO = "fill-[#1c1a16] dark:fill-[#f5f4ef]";
const SUFIXO_CLARO_ESCURO = "fill-[#5d594f] dark:fill-[#8e8b7f]";

export const CLASSES_DE_COR = {
  simbolo: SIMBOLO_CLARO_ESCURO,
  nome: NOME_CLARO_ESCURO,
  sufixo: SUFIXO_CLARO_ESCURO,
} as const;

function acessibilidade(nome: string, decorativo: boolean) {
  return decorativo
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": nome } as const);
}

function partesDoNome(nome: string) {
  const trim = nome.trim();
  if (trim.toUpperCase().endsWith(" CRM")) {
    return { principal: trim.slice(0, -4), sufixo: "CRM" };
  }
  return { principal: trim, sufixo: "" };
}

/** Símbolo do produto para a barra recolhida e superfícies compactas. */
export function SimboloDoProduto({ nome, className, decorativo = false }: Props) {
  return (
    <svg
      viewBox={SIMBOLO.viewBox}
      className={cn("shrink-0", className)}
      {...acessibilidade(nome, decorativo)}
    >
      <g transform={SIMBOLO.transform}>
        <path
          d={SIMBOLO.d}
          fill="none"
          className={SIMBOLO_CLARO_ESCURO}
          strokeWidth={SIMBOLO.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

/**
 * Wordmark padrão. O texto vem de `nome`, e não de path fixo, para a interface
 * nunca voltar a desenhar uma marca antiga quando o nome do produto mudar.
 */
export function LogotipoDoProduto({ nome, className, decorativo = false }: Props) {
  const partes = partesDoNome(nome);
  return (
    <svg
      viewBox={LOGOTIPO.viewBox}
      className={cn("shrink-0", className)}
      {...acessibilidade(nome, decorativo)}
    >
      <g transform={LOGOTIPO.simbolo.transform}>
        <path
          d={LOGOTIPO.simbolo.d}
          fill="none"
          className={SIMBOLO_CLARO_ESCURO}
          strokeWidth={LOGOTIPO.simbolo.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <text
        x="76"
        y="41"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontSize="28"
        fontWeight="650"
        letterSpacing="-0.8"
      >
        <tspan className={NOME_CLARO_ESCURO}>{partes.principal}</tspan>
        {partes.sufixo ? (
          <tspan className={SUFIXO_CLARO_ESCURO}> {partes.sufixo}</tspan>
        ) : null}
      </text>
    </svg>
  );
}
