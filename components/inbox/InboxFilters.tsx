"use client";
import { useT } from "@/hooks/i18n/useT";
import { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlass } from "@/lib/ui/icons";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChipDeEtiqueta } from "@/components/tags/ChipDeEtiqueta";
import { PontoDaEtiqueta } from "@/components/tags/PontoDaEtiqueta";
import { channelLabel, useChannelSessions } from "@/hooks/channels/useChannelSessions";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useContactTagVocabulary } from "@/hooks/contacts/useContactTagVocabulary";
import { useConversationTagVocabulary } from "@/hooks/inbox/useConversationTags";
import { useConversationCounts } from "@/hooks/inbox/useConversationCounts";
import type { Role, VisibilityMode } from "@/lib/auth/types";

export type InboxTab = "open" | "ended";
export type InboxCategory = "all" | "lead" | "client" | "support";

const INBOX_TABS: { value: InboxTab; label: string }[] = [
  { value: "open", label: "Em atendimento" },
  { value: "ended", label: "Encerrados" },
];

const INBOX_CATEGORIES: { value: InboxCategory; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "lead", label: "Leads" },
  { value: "client", label: "Clientes" },
  { value: "support", label: "Suporte" },
];

/**
 * Estado do atendimento não depende do papel. O escopo de quais conversas a
 * pessoa pode ver continua sendo decidido pela RLS; a barra só escolhe aberto
 * ou encerrado.
 */
export function visibleInboxTabs(_role: Role, _mode: VisibilityMode | undefined): InboxTab[] {
  return ["open", "ended"];
}

export interface InboxFiltersValue {
  tab: InboxTab;
  /** Recorte operacional dentro de Em atendimento. */
  categoria: InboxCategory;
  search: string;
  onlyUnread: boolean;
  channel_session_id?: string;
  tag?: string;
}

interface Props {
  value: InboxFiltersValue;
  onChange: (next: InboxFiltersValue) => void;
}

export function InboxFilters({ value, onChange }: Props) {
  const t = useT();
  const [searchInput, setSearchInput] = useState(value.search);
  /**
   * O campo escuta o valor de FORA — e só ele.
   *
   * O estado do campo é próprio porque o debounce mora nele. O preço era não
   * saber quando o filtro morria por outro caminho: "Limpar filtros" zerava a
   * busca aplicada e deixava o termo escrito na tela, mostrando uma busca que
   * não valia mais — a mesma mentira de tela que esta entrega existe para matar.
   *
   * A ref guarda o que ESTE campo propagou. Valor de fora diferente dela = a
   * mudança veio de outro lugar, e o campo adota. Igual = foi o próprio campo, e
   * adotar atropelaria quem continuou digitando.
   *
   * ⚠️ O QUE O TESTE ALCANÇA, E O QUE NÃO. Tirar este efeito reprova o primeiro
   * caso de `tests/unit/limpar-filtros-limpa-o-campo.test.tsx` — medido. Já a
   * marca lá embaixo, no timer, NÃO é alcançada por teste determinístico: ela
   * defende a corrida entre o timer disparar e este efeito rodar, e nessa fresta
   * o teste nunca consegue digitar. Medido também: sabotá-la deixa os dois casos
   * verdes. Está escrito aqui em vez de fingir cobertura que não existe.
   */
  const propagado = useRef(value.search);
  useEffect(() => {
    if (value.search !== propagado.current) {
      propagado.current = value.search;
      setSearchInput(value.search);
    }
  }, [value.search]);
  const { data: channels } = useChannelSessions({ refetchInterval: 30_000 });
  const { activeOrg } = useAuth();
  /**
   * As opções são a UNIÃO das duas caixas — as mesmas que o filtro consulta
   * (`conversations.tags` ou `contacts.tags`, no handler da lista).
   *
   * Vinham só do vocabulário de CONVERSA: o marcador escrito no contato nem
   * aparecia para ser escolhido. Quem oferece e quem filtra lendo fontes
   * diferentes é o defeito espelhado — ou a opção existe e devolve vazio, ou o
   * marcador que funciona nunca é oferecido.
   */
  const orgId = activeOrg?.orgId ?? null;
  const { data: tagsDeConversa } = useConversationTagVocabulary(orgId);
  const { data: tagsDeContato } = useContactTagVocabulary(orgId);
  const tagVocabulary = useMemo(
    () =>
      tagsDeConversa == null && tagsDeContato == null
        ? undefined
        : [...new Set([...(tagsDeConversa ?? []), ...(tagsDeContato ?? [])])].sort((a, b) =>
            a.localeCompare(b),
          ),
    [tagsDeConversa, tagsDeContato],
  );
  // Os MESMOS filtros que a lista aplicou. Badge que conta o que a aba não mostra
  // manda o atendente procurar trabalho que não existe — a regra já estava escrita
  // na rota; faltava alcançar os filtros ao lado da aba.
  const { data: counts } = useConversationCounts(activeOrg?.orgId ?? null, {
    unread: value.onlyUnread,
    tag: value.tag,
    channel_session_id: value.channel_session_id,
  });

  const tabs = activeOrg
    ? visibleInboxTabs(activeOrg.role, activeOrg.visibility_mode)
    : INBOX_TABS.map((t) => t.value);
  const countFor: Partial<Record<InboxTab, number>> = {
    open: counts?.open ?? counts?.all,
    ended: counts?.ended ?? (counts?.closed ?? 0) + (counts?.archived ?? 0),
  };
  const countForCategory: Partial<Record<InboxCategory, number>> = {
    all: counts?.open ?? counts?.all,
    lead: counts?.leads,
    client: counts?.clients,
    support: counts?.support,
  };

  // Filtrar por um número que saiu da lista (o operador acabou de excluir o
  // canal) deixa o inbox mostrando um subconjunto — às vezes vazio — sem nada na
  // tela dizendo que há filtro. O número some do dropdown junto com o canal, e o
  // alternador inteiro sumiria com ele se sobrasse menos de dois.
  const filtroForaDaLista =
    value.channel_session_id != null &&
    channels != null &&
    !channels.some((c) => c.id === value.channel_session_id);
  // Alternador só aparece com 2+ números — com um só não há o que alternar.
  const showChannelSwitch = (channels?.length ?? 0) >= 2 || filtroForaDaLista;
  // O MESMO tratamento, agora para a etiqueta. Sem ele, o seletor inteiro some
  // com o filtro AINDA APLICADO — a lista fica num subconjunto, às vezes vazio,
  // e nada na tela diz que há filtro nem oferece como tirá-lo.
  const tagForaDoVocabulario =
    value.tag != null && tagVocabulary != null && !tagVocabulary.includes(value.tag);
  const mostrarSeletorDeTag = (tagVocabulary?.length ?? 0) > 0 || tagForaDoVocabulario;

  // O timer lê o valor MAIS RECENTE, não o do render em que foi agendado.
  //
  // Antes, o efeito dependia só de `[searchInput]` e a closure capturava `value`
  // inteiro — `tab` incluso. Digitar e trocar de aba em menos de 250 ms fazia o
  // timer disparar com a aba VELHA e devolver o operador à aba anterior, sem ele
  // ter pedido. Some em teste manual: quem sabe do defeito digita devagar.
  //
  // As refs são o que permite manter `[searchInput]` como única dependência (pôr
  // `value`/`onChange` ali reagendaria o timer a cada render e a busca nunca
  // fecharia) SEM pagar o preço da closure velha.
  const valorRef = useRef(value);
  const onChangeRef = useRef(onChange);
  // A atualização vai num efeito, e não no corpo do render: escrever em ref
  // durante a renderização é proibido pela regra `react-hooks/refs` — o React
  // pode renderizar sem efetivar, e aí a ref passa a apontar para um estado que
  // nunca chegou à tela. O efeito roda depois do commit, quando `value` é real.
  useEffect(() => {
    valorRef.current = value;
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const t = setTimeout(() => {
      const atual = valorRef.current;
      if (searchInput !== atual.search) {
        // Marca ANTES de propagar: se o efeito de sincronização rodar depois de
        // a pessoa ter digitado mais uma tecla, ele veria o valor que ESTE campo
        // acabou de mandar e o adotaria por cima do que já está na tela. Sem
        // teste que alcance — ver o aviso no efeito lá em cima.
        propagado.current = searchInput;
        onChangeRef.current({ ...atual, search: searchInput });
      }
    }, 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  return (
    <div className="border-b border-border/60 bg-background/95">
      <div className="space-y-2 px-2.5 py-2.5">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <MagnifyingGlass
              size={15}
              weight="regular"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-subtle"
              aria-hidden
            />
            {/* "última mensagem", e não "mensagem": a busca alcança apenas
                `conversations.last_message_preview` — a ÚLTIMA mensagem, truncada em 200
                caracteres já na ingestão (`grep -rn 'slice(0, 200)' lib/channels/` mostra onde).
                Medido numa conversa real de 32 mensagens: buscar o que o cliente pediu na
                3ª devolve ZERO. Alcançar o histórico é projeto próprio (índice trigram +
                retenção + LGPD); até lá, a tela não promete o que o backend não faz. */}
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t("Buscar por nome, telefone ou última mensagem…")}
              className="h-8 rounded-lg border-border/60 bg-muted/25 pl-9 text-[12px] shadow-none transition-[background,border-color,box-shadow] placeholder:text-muted-foreground/70 focus-visible:border-accent/35 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-accent/10"
              aria-label={t("Buscar conversas")}
            />
          </div>
          {/* Botão pressionável em vez de Switch: o filtro vive na mesma linha
              da busca, e o Switch com rótulo pedia uma linha inteira só para
              si numa coluna de 280px. */}
          <button
            type="button"
            aria-pressed={value.onlyUnread}
            onClick={() => onChange({ ...value, onlyUnread: !value.onlyUnread })}
            className={cn(
              "h-8 shrink-0 rounded-lg border px-2.5 text-[10px] font-semibold transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden",
              value.onlyUnread
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border/60 bg-background text-text-muted hover:bg-muted",
            )}
          >
            {t("Não lidos")}
          </button>
        </div>

        {(showChannelSwitch || mostrarSeletorDeTag) && (
          <div className="flex gap-2">
            {showChannelSwitch && (
              <Select
                value={value.channel_session_id ?? "all"}
                onValueChange={(v) =>
                  onChange({ ...value, channel_session_id: v === "all" ? undefined : v })
                }
              >
                <SelectTrigger
                  className={cn(
                    "h-8 min-w-0 flex-1 rounded-full border-transparent bg-surface-elevated px-3 text-xs shadow-none",
                    value.channel_session_id != null && "border-accent bg-accent-soft text-accent",
                  )}
                  aria-label={t("Filtrar por número de WhatsApp")}
                >
                  <SelectValue placeholder={t("Todos os números")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("Todos os números")}</SelectItem>
                  {filtroForaDaLista && value.channel_session_id != null && (
                    <SelectItem value={value.channel_session_id}>{t("Número removido")}</SelectItem>
                  )}
                  {channels?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {channelLabel(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {mostrarSeletorDeTag && (
              <Select
                value={value.tag ?? "all"}
                onValueChange={(v) => onChange({ ...value, tag: v === "all" ? undefined : v })}
              >
                <SelectTrigger
                  className={cn(
                    "h-8 min-w-0 flex-1 rounded-full border-transparent bg-surface-elevated px-3 text-xs shadow-none",
                    value.tag != null && "border-accent bg-accent-soft text-accent",
                  )}
                  aria-label={t("Filtrar por tag")}
                >
                  {/* O gatilho mostra o CHIP da etiqueta filtrada, e não o texto
                      cru: é a mesma cor que a lista mostra ao lado, e é o que
                      faz o filtro ativo se reconhecer de relance — mesma razão
                      do `border-accent` acima. Sem filtro, o texto continua
                      sendo o de sempre (`Todas as tags`). */}
                  <SelectValue placeholder={t("Todas as tags")}>
                    {value.tag ? (
                      <ChipDeEtiqueta tag={value.tag} className="h-5 px-1.5 text-[11px]" />
                    ) : (
                      t("Todas as tags")
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("Todas as tags")}</SelectItem>
                  {/* A órfã entra na lista: sem ela o Select mostraria o
                      placeholder no lugar do valor JÁ selecionado, e o operador
                      veria "Todas as tags" com um filtro ativo. */}
                  {[
                    ...(tagVocabulary ?? []),
                    ...(tagForaDoVocabulario && value.tag ? [value.tag] : []),
                  ].map((tag) => (
                    <SelectItem key={tag} value={tag}>
                      {/* Ponto, não chip: a opção é uma linha de 280 px que já
                          divide espaço com o filtro de número. O nome continua
                          sendo o que se lê; a cor só acelera o reconhecimento
                          de quem já conhece o vocabulário da operação. */}
                      <span className="inline-flex items-center gap-2">
                        <PontoDaEtiqueta tag={tag} />
                        {tag}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}
      </div>

      {/* Faixa sublinhada, não caixa cinza: cinco abas num grid de 280px
          espremiam "Fechadas" contra "Automático" até os rótulos se tocarem. */}
      <Tabs
        value={value.tab}
        onValueChange={(v) => onChange({ ...value, tab: v as InboxTab })}
        className="px-2.5"
      >
        <TabsList className="grid h-9 w-full grid-cols-2 rounded-lg bg-muted/55 p-1">
          {tabs.map((tab) => {
            const meta = INBOX_TABS.find((t) => t.value === tab)!;
            const count = countFor[tab];
            return (
              <TabsTrigger
                key={tab}
                value={tab}
                className="h-7 min-w-0 gap-1 rounded-md px-2 text-[11px] font-semibold text-text-muted data-[state=active]:bg-background data-[state=active]:text-text data-[state=active]:shadow-sm"
              >
                <span className="truncate">{t(meta.label)}</span>
                {typeof count === "number" && count > 0 && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-text-subtle tabular-nums">
                    {count}
                  </span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {value.tab === "open" && (
        <div className="px-2.5 pt-2 pb-2.5">
          <div className="grid grid-cols-4 gap-1 rounded-lg border border-border/50 bg-background p-1">
            {INBOX_CATEGORIES.map((categoria) => {
              const ativo = value.categoria === categoria.value;
              const count = countForCategory[categoria.value];
              return (
                <button
                  key={categoria.value}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => onChange({ ...value, categoria: categoria.value })}
                  className={cn(
                    "flex h-7 min-w-0 items-center justify-center gap-1 rounded-md px-1 text-[10px] font-medium transition-colors",
                    ativo
                      ? "bg-accent-soft text-accent shadow-sm"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <span className="truncate">{t(categoria.label)}</span>
                  {typeof count === "number" && count > 0 && (
                    <span className="text-[9px] tabular-nums opacity-75">{count}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
