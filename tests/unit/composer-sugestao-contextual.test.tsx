import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/inbox/useSendMessage", () => ({
  useSendMessage: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useCreateNote", () => ({
  useCreateNote: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useUploadMedia", () => ({
  useUploadMedia: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useMessageTemplates", () => ({
  useMessageTemplates: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/inbox/useQuickReplySuggestion", () => ({
  useQuickReplySuggestion: () => ({
    data: {
      shortcut: "cobranca",
      motivo: "Há uma pendência financeira registrada para este cliente.",
      prioridade: 100,
    },
    isLoading: false,
  }),
}));
vi.mock("@/hooks/inbox/useDraftReply", () => ({
  useDraftReply: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { Composer } from "@/components/inbox/Composer";

describe("Composer + sugestão contextual", () => {
  it("mostra o motivo e aplica a resposta sugerida mesmo sem pacote instalado", () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <Composer
          conversationId="conv-1"
          currentContactId="contact-1"
          contactName="Ana Pereira"
          organizationName="PeríciaIA"
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText(/Sugestão para este cliente/i)).toHaveTextContent("Cobrança cordial");
    expect(
      screen.getByText("Há uma pendência financeira registrada para este cliente."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Usar" }));

    expect(screen.getByLabelText(/mensagem/i)).toHaveValue(
      "Oi Ana, tudo bem? Identificamos uma pendência financeira no seu cadastro. Posso te enviar os dados para regularização ou verificar alguma dúvida sobre a cobrança?",
    );
  });

  it("permite dispensar a sugestão sem apagar respostas rápidas", () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <Composer conversationId="conv-1" currentContactId="contact-1" />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dispensar sugestão" }));
    expect(screen.queryByText(/Sugestão para este cliente/i)).not.toBeInTheDocument();
  });
});
