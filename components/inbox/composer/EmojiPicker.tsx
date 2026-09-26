"use client";

import { useEffect, useRef, useState } from "react";
import { Picker } from "emoji-mart";
import pt from "@emoji-mart/data/i18n/pt.json";
import { useT } from "@/hooks/i18n/useT";

interface Props {
  data: () => Promise<unknown>;
  locale: "pt";
  previewPosition: "none" | "top" | "bottom";
  onEmojiSelect: (emoji: { native: string }) => void;
}

/** O DOM do picker pertence ao web component; React só possui o contêiner. */
export default function EmojiPicker({ data, locale, previewPosition, onEmojiSelect }: Props) {
  const t = useT();
  const container = useRef<HTMLDivElement>(null);
  const latestSelect = useRef(onEmojiSelect);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    latestSelect.current = onEmojiSelect;
  }, [onEmojiSelect]);

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    let cancelled = false;
    let element: Node | null = null;
    setStatus("loading");

    // Carrega antes de conectar: emoji-mart não propaga rejeições do seu init().
    // Tradução local evita a busca implícita no CDN durante connectedCallback.
    void (async () => {
      try {
        const loaded = await data();
        if (cancelled) return;
        if (!loaded) throw new Error("Dados de emoji ausentes");
        const picker = new Picker({
          data: loaded,
          i18n: pt,
          locale,
          previewPosition,
          onEmojiSelect: (emoji: { native?: string }) => {
            if (!cancelled && typeof emoji.native === "string" && emoji.native) {
              latestSelect.current({ native: emoji.native });
            }
          },
        });
        element = picker as unknown as Node;
        host.appendChild(element);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      // Remover dispara disconnectedCallback: remove listener global e observers.
      if (element?.parentNode === host) host.removeChild(element);
    };
    // Configuração recria a instância; update() perde props antes do init terminar.
  }, [data, locale, previewPosition]);

  return (
    <div>
      {status === "loading" && <p role="status">{t("Carregando emojis…")}</p>}
      {status === "error" && (
        <p role="alert">{t("Não foi possível carregar os emojis. Feche e abra o seletor para tentar novamente.")}</p>
      )}
      <div ref={container} />
    </div>
  );
}
