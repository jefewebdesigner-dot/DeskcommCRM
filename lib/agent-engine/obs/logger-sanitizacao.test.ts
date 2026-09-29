import { describe, expect, it, vi } from "vitest";

import { comSanitizacao, sanitizarTexto, type Logger } from "./logger";

describe("sanitizarTexto", () => {
  it("apaga e-mail, telefone, token e string de conexão", () => {
    const suja =
      "falhou para ana.silva@exemplo.com.br no +55 (31) 99999-8888 com Bearer abcdef1234567890 em postgresql://u:senha@host/db e sk-abcdefghijklmnop";
    const limpa = sanitizarTexto(suja);
    expect(limpa).not.toMatch(/ana\.silva|99999|senha|abcdef1234567890|sk-abcdef/);
    expect(limpa).toContain("[email]");
    expect(limpa).toContain("[numero]");
  });

  it("preserva UUID de job", () => {
    expect(sanitizarTexto("job 3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b falhou")).toContain("3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b");
  });

  it("não estraga texto comum nem contagens curtas", () => {
    expect(sanitizarTexto("reaper devolveu 3 jobs órfãos em 250ms")).toBe("reaper devolveu 3 jobs órfãos em 250ms");
  });
});

describe("comSanitizacao", () => {
  it("limpa mensagem e campos e entrega o último erro já limpo", () => {
    const base: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const aoErro = vi.fn();
    const log = comSanitizacao(base, aoErro);
    log.error("job falhou", { error: "cliente joao@x.com ligou para 31999998888", job: "j1" });
    expect(aoErro).toHaveBeenCalledWith(expect.not.stringMatching(/joao@|31999998888/));
    const campos = (base.error as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Record<string, string>;
    expect(campos.error).not.toMatch(/joao@|31999998888/);
    expect(campos.job).toBe("j1");
  });
});
