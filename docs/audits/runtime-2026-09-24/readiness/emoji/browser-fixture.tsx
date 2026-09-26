import { StrictMode, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { EmojiButton } from "./EmojiButton";

export function Fixture() {
  const [text, setText] = useState("");
  const [revision, setRevision] = useState(1);
  return <StrictMode><main>
    <h1>Prova isolada do seletor de emojis</h1>
    <button onClick={() => setRevision((n) => n + 1)}>Trocar callback</button>
    <label>Mensagem<input aria-label="Mensagem" value={text} onChange={(e) => setText(e.target.value)} /></label>
    <EmojiButton onPick={(emoji) => setText((s) => `${s}${revision}:${emoji}`)} />
    <output aria-label="Revisão">{revision}</output>
  </main></StrictMode>;
}

if (typeof window !== "undefined") hydrateRoot(document.getElementById("root")!, <Fixture />);
