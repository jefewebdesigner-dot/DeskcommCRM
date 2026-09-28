import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DetalheDoCompromisso } from "@/components/agenda/DetalheDoCompromisso";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({ apiClient: api }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));
vi.mock("@/hooks/inbox/useAssignableMembers", () => ({
  useAssignableMembers: () => ({
    data: [
      { user_id: "11111111-1111-4111-8111-111111111111", role: "admin", full_name: "Jeferson" },
      { user_id: "22222222-2222-4222-8222-222222222222", role: "agent", full_name: "Luan" },
    ],
    isPending: false,
  }),
}));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
}));

const CONTATO = "33333333-3333-4333-8333-333333333333";
const JEFERSON = "11111111-1111-4111-8111-111111111111";

const detalhe = {
  id: "44444444-4444-4444-8444-444444444444",
  title: "Reunião comercial",
  description: null,
  location_kind: null,
  location_details: null,
  starts_at: "2026-09-28T10:00:00Z",
  ends_at: "2026-09-28T11:00:00Z",
  time_zone: "America/Sao_Paulo",
  status: "completed",
  revision: 2,
  responsavel_id: JEFERSON,
  contact_id: CONTATO,
  conversation_id: "55555555-5555-4555-8555-555555555555",
  outcome_source_kind: "user",
  outcome_recorded_at: "2026-09-28T11:05:00Z",
  recovery: null,
  evidence_messages: [],
};

let client: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  api.get.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/v1/agenda/agendamentos/")) return { data: detalhe };
    if (url.startsWith("/api/v1/tasks?")) return { data: { tasks: [] } };
    throw new Error(`GET inesperado: ${url}`);
  });
  api.post.mockResolvedValue({
    data: {
      task: {
        id: "66666666-6666-4666-8666-666666666666",
        title: "Enviar proposta",
      },
    },
  });
});

afterEach(() => {
  cleanup();
  client.clear();
});

function abrir() {
  return render(
    <IdiomaProvider locale="pt-BR">
      <QueryClientProvider client={client}>
        <DetalheDoCompromisso id={detalhe.id} onClose={() => {}} />
      </QueryClientProvider>
    </IdiomaProvider>,
  );
}

describe("Agenda → próximo passo → tarefa", () => {
  it("depois do compromisso mostra a lacuna operacional até existir tarefa", async () => {
    abrir();

    expect(await screen.findByTestId("proximo-passo-do-compromisso")).toBeTruthy();
    expect(await screen.findByText("Ainda não há próximo passo registrado.")).toBeTruthy();
  });

  it("preset cria tarefa para o responsável do compromisso e preserva o contato", async () => {
    abrir();
    await screen.findByTestId("proximo-passo-do-compromisso");

    fireEvent.click(screen.getByRole("button", { name: "Enviar proposta" }));
    const criar = screen.getByRole("button", { name: "Criar tarefa de próximo passo" });
    expect(criar).not.toBeDisabled();
    fireEvent.click(criar);

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith(
      "/api/v1/tasks",
      expect.objectContaining({
        title: "Enviar proposta",
        priority: "high",
        status: "pending",
        contact_id: CONTATO,
        assigned_to: JEFERSON,
        due_date: expect.any(String),
      }),
    );
  });
});
