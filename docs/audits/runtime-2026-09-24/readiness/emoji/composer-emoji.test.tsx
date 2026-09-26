import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const observed = vi.hoisted(() => ({ instances: [] as HTMLElement[], disconnects: 0 }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("emoji-mart", () => {
  type Options = { onEmojiSelect: (e: { native: string }) => void };
  class FakePicker extends HTMLElement {
    constructor(props: Options) {
      super();
      observed.instances.push(this);
      const button = document.createElement("button");
      button.textContent = "picker-fake";
      button.onclick = () => props.onEmojiSelect({ native: "😀" });
      this.appendChild(button);
    }
    disconnectedCallback() { observed.disconnects += 1; }
    // A implementação real ignora update antes da inicialização; não fingir sucesso.
    update() {}
  }
  customElements.define("test-emoji-picker-readiness", FakePicker);
  return { Picker: FakePicker };
});
vi.mock("@emoji-mart/data", () => ({ default: {} }));

import { EmojiButton } from "@/components/inbox/composer/EmojiButton";
import EmojiPicker from "@/components/inbox/composer/EmojiPicker";

const data = async () => ({});
const base = { data, locale: "pt" as const, previewPosition: "none" as const };
afterEach(cleanup);
beforeEach(() => { observed.instances = []; observed.disconnects = 0; });

describe("EmojiButton — adaptador DOM de emoji-mart", () => {
  it("só cria ao abrir, propaga uma escolha e desconecta ao fechar", async () => {
    const onPick = vi.fn();
    render(<EmojiButton onPick={onPick} />);
    expect(observed.instances).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /emoji/i }));
    fireEvent.click(await screen.findByText("picker-fake"));
    expect(onPick).toHaveBeenCalledExactlyOnceWith("😀");
    fireEvent.keyDown(screen.getByText("picker-fake"), { key: "Escape" });
    await waitFor(() => expect(observed.disconnects).toBe(1));
  });

  it("não abre quando desabilitado", () => {
    render(<EmojiButton onPick={vi.fn()} disabled />);
    fireEvent.click(screen.getByRole("button", { name: /emoji/i }));
    expect(observed.instances).toHaveLength(0);
  });

  it("usa callback atual sem recriar o picker", async () => {
    const old = vi.fn(); const next = vi.fn();
    const view = render(<EmojiPicker {...base} onEmojiSelect={old} />);
    await screen.findByText("picker-fake");
    view.rerender(<EmojiPicker {...base} onEmojiSelect={next} />);
    fireEvent.click(screen.getByText("picker-fake"));
    expect(next).toHaveBeenCalledExactlyOnceWith({ native: "😀" });
    expect(old).not.toHaveBeenCalled();
    expect(observed.instances).toHaveLength(1);
  });

  it("não perde callback alterado enquanto dados carregam", async () => {
    let resolve!: (v: object) => void;
    const deferred = new Promise<object>((r) => { resolve = r; });
    const load = () => deferred;
    const old = vi.fn(); const next = vi.fn();
    const view = render(<EmojiPicker {...base} data={load} onEmojiSelect={old} />);
    view.rerender(<EmojiPicker {...base} data={load} onEmojiSelect={next} />);
    await act(async () => { resolve({}); });
    fireEvent.click(await screen.findByText("picker-fake"));
    expect(next).toHaveBeenCalledExactlyOnceWith({ native: "😀" });
    expect(old).not.toHaveBeenCalled();
  });

  it("recria configuração e desconecta a instância antiga", async () => {
    const cb = vi.fn();
    const view = render(<EmojiPicker {...base} onEmojiSelect={cb} />);
    await screen.findByText("picker-fake");
    const old = observed.instances[0]!;
    view.rerender(<EmojiPicker {...base} previewPosition="top" onEmojiSelect={cb} />);
    await screen.findByText("picker-fake");
    expect(observed.instances).toHaveLength(2);
    expect(observed.disconnects).toBe(1);
    old.querySelector("button")!.click();
    expect(cb).not.toHaveBeenCalled();
  });

  it("StrictMode deixa uma instância conectada e limpa no unmount", async () => {
    const view = render(<StrictMode><EmojiPicker {...base} onEmojiSelect={vi.fn()} /></StrictMode>);
    await screen.findByText("picker-fake");
    expect(observed.instances.filter((p) => p.isConnected)).toHaveLength(1);
    view.unmount();
    expect(observed.instances.filter((p) => p.isConnected)).toHaveLength(0);
    expect(observed.disconnects).toBe(1);
  });

  it("unmount antes de carregar não cria picker tardio", async () => {
    let resolve!: (v: object) => void;
    const deferred = new Promise<object>((r) => { resolve = r; });
    const view = render(<EmojiPicker {...base} data={() => deferred} onEmojiSelect={vi.fn()} />);
    view.unmount();
    await act(async () => { resolve({}); });
    expect(observed.instances).toHaveLength(0);
  });

  it("mostra falha de dados e permite nova montagem", async () => {
    const view = render(<EmojiPicker {...base} data={async () => { throw new Error("offline"); }} onEmojiSelect={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Feche e abra");
    expect(observed.instances).toHaveLength(0);
    view.unmount();
    render(<EmojiPicker {...base} onEmojiSelect={vi.fn()} />);
    await screen.findByText("picker-fake");
  });

  it("SSR não instancia custom element", () => {
    const html = renderToString(<EmojiPicker {...base} onEmojiSelect={vi.fn()} />);
    expect(html).toContain("Carregando");
    expect(observed.instances).toHaveLength(0);
  });
});
