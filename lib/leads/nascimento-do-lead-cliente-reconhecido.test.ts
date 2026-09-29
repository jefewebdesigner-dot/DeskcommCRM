import { describe, expect, it, vi } from "vitest";

vi.mock("./activity-emitter", () => ({ emitLeadActivity: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/contacts/cliente-pela-agenda", () => ({ lerClientePelaAgenda: vi.fn(async () => false) }));

import { garantirLeadDaConversa } from "./nascimento-do-lead";

const ORG = "org-1";
const FUNIL_CLIENTES = "pipe-clientes";
const FUNIL_VENDAS = "pipe-vendas";

// Banco falso: cada consulta registra os filtros `.eq()` e responde por tabela.
function bancoFalso(contato: Record<string, unknown>) {
  const rpc = vi.fn(async () => ({ data: "lead-novo", error: null }));
  const from = (tabela: string) => {
    const filtros: Record<string, unknown> = {};
    const cadeia: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit"]) cadeia[m] = () => cadeia;
    cadeia.eq = (col: string, val: unknown) => { filtros[col] = val; return cadeia; };
    cadeia.maybeSingle = async () => {
      if (tabela === "contacts") return { data: contato, error: null };
      if (tabela === "crm_leads") return { data: null, error: null }; // sem lead aberto
      if (tabela === "crm_pipelines") {
        if (filtros.is_client_pipeline === true) return { data: { id: FUNIL_CLIENTES }, error: null };
        if (filtros.is_default === true) return { data: { id: FUNIL_VENDAS }, error: null };
      }
      if (tabela === "crm_stages") return { data: { id: `etapa-de-${String(filtros.pipeline_id)}` }, error: null };
      return { data: null, error: null };
    };
    return cadeia;
  };
  return { db: { from, rpc } as never, rpc };
}

const DADOS = { organizationId: ORG, contactId: "c-1", conversationId: "conv-1", nomeDoContato: "Fulano" };

describe("garantirLeadDaConversa — cliente reconhecido", () => {
  it("client_recognized_at leva ao funil de clientes, mesmo sem first_service_at nem interruptor da agenda", async () => {
    const { db, rpc } = bancoFalso({ is_blocked: false, name: "Fulano", client_recognized_at: "2026-09-29T00:00:00Z", first_service_at: null });
    const r = await garantirLeadDaConversa(db, DADOS);
    expect(r).toMatchObject({ criado: true, pipelineId: FUNIL_CLIENTES });
    expect(rpc).toHaveBeenCalledWith("fn_nascer_lead_da_conversa", expect.objectContaining({ p_pipeline: FUNIL_CLIENTES }));
  });

  it("sem reconhecimento e sem atendimento, entra no funil padrão (Vendas)", async () => {
    const { db } = bancoFalso({ is_blocked: false, name: "Fulano", client_recognized_at: null, first_service_at: null });
    expect(await garantirLeadDaConversa(db, DADOS)).toMatchObject({ criado: true, pipelineId: FUNIL_VENDAS });
  });

  it("first_service_at sozinho continua dependendo do interruptor da agenda (desligado no teste)", async () => {
    const { db } = bancoFalso({ is_blocked: false, name: "Fulano", client_recognized_at: null, first_service_at: "2026-09-01T00:00:00Z" });
    expect(await garantirLeadDaConversa(db, DADOS)).toMatchObject({ criado: true, pipelineId: FUNIL_VENDAS });
  });
});
