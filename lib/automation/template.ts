import { resolveField } from "@/lib/automation/conditions";

const ALIASES: Record<string, string> = {
  nome: "contact.name",
  telefone: "contact.phone_number",
  email: "contact.email",
};

export interface RenderTemplateOptions {
  /**
   * Texto INTERNO (título de tarefa, nota): `{{nome}}` sem nome cai para telefone,
   * e-mail e por fim "contato sem nome", em vez de sumir e deixar "Fazer primeiro
   * contato com" cortado no meio. Fica desligado por padrão porque em mensagem
   * PARA O CLIENTE "Olá +5511…" é pior que "Olá".
   */
  nomeComFallback?: boolean;
}

function textoOuNull(valor: unknown): string | null {
  if (valor === undefined || valor === null) return null;
  const texto = String(valor).trim();
  return texto === "" ? null : texto;
}

export function renderTemplate(
  template: string,
  context: Record<string, unknown>,
  options: RenderTemplateOptions = {},
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    const resolved = resolveField(context, ALIASES[path] ?? path);
    if (options.nomeComFallback && (path === "nome" || path === "contact.name")) {
      return (
        textoOuNull(resolved) ??
        textoOuNull(resolveField(context, "contact.phone_number")) ??
        textoOuNull(resolveField(context, "contact.email")) ??
        "contato sem nome"
      );
    }
    return resolved === undefined || resolved === null ? "" : String(resolved);
  });
}
