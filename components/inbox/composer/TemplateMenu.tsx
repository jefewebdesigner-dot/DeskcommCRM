"use client";
import { useT } from "@/hooks/i18n/useT";
import type { MessageTemplate } from "@/hooks/inbox/useMessageTemplates";

/** Estado do slash-menu a partir do texto do composer. Puro (testável). */
export function resolveSlash(text: string): { open: boolean; query: string } {
  if (!text.startsWith("/")) return { open: false, query: "" };
  const rest = text.slice(1);
  if (/\s/.test(rest)) return { open: false, query: "" };
  return { open: true, query: rest };
}

interface Props {
  open: boolean;
  query: string;
  templates: MessageTemplate[];
  onPick: (t: MessageTemplate) => void;
  onClose: () => void;
}

export function TemplateMenu({ open, query, templates, onPick, onClose: _onClose }: Props) {
  const t = useT();
  if (!open) return null;
  const q = query.toLowerCase();
  const filtered = templates
    .filter(
      (tpl) =>
        tpl.title.toLowerCase().includes(q) ||
        tpl.body.toLowerCase().includes(q) ||
        (tpl.shortcut ?? "").toLowerCase().includes(q),
    )
    .sort((a, b) => {
      const atalhoA = (a.shortcut ?? "").toLowerCase();
      const atalhoB = (b.shortcut ?? "").toLowerCase();
      const rank = (atalho: string, titulo: string) => {
        if (q && atalho === q) return 0;
        if (q && atalho.startsWith(q)) return 1;
        if (q && titulo.toLowerCase().startsWith(q)) return 2;
        return 3;
      };
      return rank(atalhoA, a.title) - rank(atalhoB, b.title) || a.title.localeCompare(b.title);
    });
  return (
    <div
      className="absolute bottom-14 left-3 z-20 max-h-64 w-80 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
      role="listbox"
      aria-label={t("Respostas rápidas")}
    >
      {filtered.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          {t("Nenhuma resposta rápida. Crie no módulo Respostas rápidas.")}
        </div>
      ) : (
        filtered.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            className="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left hover:bg-muted"
            onClick={() => onPick(tpl)}
          >
            <span className="flex w-full items-center justify-between gap-2 text-sm font-medium">
              <span className="truncate">{tpl.title}</span>
              {tpl.shortcut ? (
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  /{tpl.shortcut}
                </span>
              ) : null}
            </span>
            <span className="line-clamp-1 text-xs text-muted-foreground">{tpl.body}</span>
          </button>
        ))
      )}
    </div>
  );
}
