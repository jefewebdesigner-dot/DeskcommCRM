/**
 * Trava de disparo para contatos vindos de importação histórica.
 *
 * A migração do CRM antigo do PeríciaIA (Firebase) traz centenas de pessoas para
 * o CRM novo. Importar é mover DADOS e CLASSIFICAÇÃO — nunca é autorização para
 * falar com ninguém. A campanha de recuperação (leads antigos e cancelados) é uma
 * decisão separada, tomada depois, por uma ação explícita.
 *
 * Por isso a marca vive no contato e a recusa vive no PORTÃO ÚNICO dos envios
 * proativos (`lib/agenda/efeito.ts`, por onde passam mensagem, ação de WhatsApp,
 * ação de IA, follow-up e texto fixo) — e não espalhada por cada worker, que é o
 * "conserto por instância" que este repositório já pagou (ver
 * `lib/automation/guarda-do-contato.ts`).
 *
 * Só bloqueia o que é PROATIVO. Responder a quem escreveu para nós continua
 * permitido: quem nos procurou não está sendo prospectado (mesma régua do gate de
 * LGPD em `lib/agent-engine/guardrails/lgpd/legal-basis.ts`).
 */

/** `contacts.source` e `crm_leads.source` de tudo que a migração histórica cria. */
export const ORIGEM_IMPORTACAO_LEGADO = "periciaia_legado";
/** Tag no contato: veio da importação histórica. */
export const TAG_IMPORTACAO_LEGADO = "importacao_legado";
/** Tag no contato: sem e-mail e sem telefone — inelegível até alguém recuperar um. */
export const TAG_REVISAO_SEM_CONTATO = "revisao_sem_contato";

export type BloqueioDeDisparo = "importacao_legado" | "revisao_sem_contato";

export interface ContatoParaDisparo {
  source?: string | null;
  source_metadata?: Record<string, unknown> | null;
  tags?: readonly string[] | null;
}

/**
 * Por que este contato NÃO pode receber envio proativo (ou `null` se pode).
 *
 * - `revisao_sem_contato` vence tudo: sem meio de contato válido não há o que
 *   liberar, e a liberação de campanha não o alcança.
 * - `importacao_legado` cai quando o contato recebe `campanha_liberada: true` em
 *   `source_metadata` — a ação explícita que abre a campanha de recuperação.
 */
export function bloqueioDeDisparoDoContato(
  contato: ContatoParaDisparo | null | undefined,
): BloqueioDeDisparo | null {
  if (!contato) return null;
  const tags = contato.tags ?? [];
  const meta = contato.source_metadata ?? {};

  if (tags.includes(TAG_REVISAO_SEM_CONTATO) || meta.revisao_sem_contato === true) {
    return "revisao_sem_contato";
  }

  const veioDaImportacao =
    contato.source === ORIGEM_IMPORTACAO_LEGADO ||
    tags.includes(TAG_IMPORTACAO_LEGADO) ||
    meta.importacao_legado === true;
  if (!veioDaImportacao) return null;

  return meta.campanha_liberada === true ? null : "importacao_legado";
}

/** Lançado pelo portão de envios proativos. Definitivo: não é adiamento nem retry. */
export class DisparoBloqueadoError extends Error {
  readonly code = "disparo_bloqueado";
  constructor(readonly motivo: BloqueioDeDisparo) {
    super(
      motivo === "revisao_sem_contato"
        ? "Contato sem meio de contato válido (revisão pendente): envio proativo bloqueado."
        : "Contato da importação histórica: envio proativo bloqueado até a campanha ser liberada.",
    );
    this.name = "DisparoBloqueadoError";
  }
}
