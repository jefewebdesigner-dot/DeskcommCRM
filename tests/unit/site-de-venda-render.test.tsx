import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SiteDeVenda } from "@/components/marketing/SiteDeVenda";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("site de venda do Gravity CRM", () => {
  it("monta as seções, com a marca certa e sem conteúdo fictício", () => {
    const { container } = render(<SiteDeVenda destinoDoFormulario="" />);
    const texto = container.textContent ?? "";
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Vendas, Customer Success/);
    expect(texto).toContain("Gravity CRM");
    expect(texto).toContain("R$ 99,90");
    expect(texto).not.toMatch(/fict[ií]ci|Gravity\. IA|R$ 000|\(00\) 00000/i);
    for (const id of ["como-funciona", "planos", "demo", "perguntas"]) expect(container.querySelector("#" + id)).not.toBeNull();
  });

  it("o formulário envia o pedido para o destino configurado, como contato vindo da landing", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<SiteDeVenda destinoDoFormulario="https://gravityia.tech/api/crm/entrada/gce_teste" />);
    const form = container.querySelector("form.mkt-demo-form") as HTMLFormElement;
    (form.querySelector('[name="nome"]') as HTMLInputElement).value = "Maria Teste";
    (form.querySelector('[name="whatsapp"]') as HTMLInputElement).value = "11912345678";
    (form.querySelector('[name="email"]') as HTMLInputElement).value = "maria@example.com";
    (form.querySelector('[name="segmento"]') as HTMLSelectElement).value = "Loja";
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText(/Recebemos seu pedido/)).toBeTruthy());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://gravityia.tech/api/crm/entrada/gce_teste");
    expect(JSON.parse(String(init.body))).toMatchObject({ nome: "Maria Teste", origem: "landing", email: "maria@example.com" });
  });

  it("sem destino configurado, avisa que não enviou em vez de fingir", async () => {
    const { container } = render(<SiteDeVenda destinoDoFormulario="" />);
    fireEvent.submit(container.querySelector("form.mkt-demo-form") as HTMLFormElement);
    await waitFor(() => expect(screen.getByText(/Não deu para enviar/)).toBeTruthy());
  });
});
