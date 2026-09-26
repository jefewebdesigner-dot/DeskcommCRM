"use client";

import { useEffect, useRef } from "react";
import { Picker } from "emoji-mart";

interface Props {
  data: () => Promise<unknown>;
  locale: string;
  previewPosition: string;
  onEmojiSelect: (emoji: { native: string }) => void;
}

/** Integra o web component sem o adaptador limitado a React 16–18. */
export default function EmojiPicker(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<Picker | null>(null);
  const latest = useRef(props);

  useEffect(() => {
    latest.current = props;
    instance.current?.update(props);
  });

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    const picker = new Picker(latest.current);
    instance.current = picker;
    host.appendChild(picker as unknown as Node);
    return () => {
      host.replaceChildren();
      instance.current = null;
    };
  }, []);

  return <div ref={container} />;
}
