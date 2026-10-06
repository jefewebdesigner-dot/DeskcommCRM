import type { Lead } from "@/lib/types/leads";

/**
 * Ordem da LISTA do funil: o que pede ação aparece primeiro.
 *
 * O quadro ordena por posição (a ordem em que a pessoa arrastou). Uma lista de
 * trabalho tem outra pergunta — "o que eu faço agora?" — e responde com esta
 * ordem: (1) cliente que escreveu e não foi lido; (2) tarefa/compromisso já
 * vencido; (3) o contato mais recente primeiro, para que quem esfriou desça.
 * Empate cai na posição do quadro, para a ordem ser estável entre renderizações.
 */
type LeadDaLista = Pick<Lead, "id" | "position_in_stage" | "conversa" | "next_operation">;

function tempo(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

export function ordenarParaAtendimento<T extends LeadDaLista>(leads: T[], agora = Date.now()): T[] {
  const pontua = (l: T) => {
    const naoLidas = l.conversa?.unread ?? 0;
    const vencida = l.next_operation?.at ? tempo(l.next_operation.at) < agora : false;
    return {
      naoLidas: naoLidas > 0 ? 1 : 0,
      vencida: vencida ? 1 : 0,
      ultimaMensagem: tempo(l.conversa?.last_message_at),
    };
  };
  return [...leads].sort((a, b) => {
    const pa = pontua(a);
    const pb = pontua(b);
    return (
      pb.naoLidas - pa.naoLidas ||
      pb.vencida - pa.vencida ||
      pb.ultimaMensagem - pa.ultimaMensagem ||
      (a.position_in_stage ?? 0) - (b.position_in_stage ?? 0) ||
      a.id.localeCompare(b.id)
    );
  });
}

/** "há 3 min", "há 2 h", "há 5 d" — curto, porque a coluna é estreita. */
export function haQuantoTempo(iso: string | null | undefined, agora = Date.now()): string | null {
  const t = tempo(iso);
  if (!t) return null;
  const min = Math.max(0, Math.round((agora - t) / 60_000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}
