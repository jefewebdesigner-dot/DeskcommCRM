"use client";

import { useState, type FormEvent } from "react";

type Status = "idle" | "sending" | "sent" | "error";

/**
 * Pedido de demonstração. `destino` vem do servidor (env SITE_DE_VENDA_FORM_URL)
 * — em geral a entrada de contatos do Gravity IA (`/api/crm/entrada/<chave>`),
 * que só cria o contato e aceita JSON { nome, whatsapp, email, mensagem, origem }.
 * Sem destino configurado o formulário diz que não pôde enviar, em vez de
 * fingir que enviou.
 */
export function DemoForm({ destino }: { destino: string }) {
  const [status, setStatus] = useState<Status>("idle");

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!destino) {
      setStatus("error");
      return;
    }
    const form = e.currentTarget;
    const data = new FormData(form);
    setStatus("sending");
    try {
      const res = await fetch(destino, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: data.get("nome"),
          whatsapp: data.get("whatsapp"),
          email: data.get("email"),
          origem: "landing",
          mensagem: "Pedido de demonstração do Gravity CRM — segmento: " + String(data.get("segmento") ?? ""),
          // Campo-isca contra robô: pessoa não vê nem preenche.
          website: data.get("website"),
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus("sent");
      form.reset();
    } catch {
      setStatus("error");
    }
  };

  return (
    <section className="mkt-section mkt-demo-section" id="demo">
      <div className="mkt-demo-inner">
        <div className="mkt-demo-text">
          <p className="mkt-eyebrow">Agende uma demonstração</p>
          <h2 className="mkt-section-heading">Veja o Gravity CRM com a sua operação</h2>
          <p className="mkt-demo-desc">
            Conversamos sobre como seu time vende, atende e renova hoje, e mostramos
            como isso fica no Gravity CRM — com o plano certo para o tamanho da sua equipe.
          </p>
          <ul className="mkt-demo-points">
            <li>Demonstração com a nossa equipe</li>
            <li>Proposta do plano certo para o seu time</li>
            <li>Sem compromisso</li>
          </ul>
        </div>

        {status === "sent" ? (
          <div className="mkt-demo-success">
            <p className="mkt-demo-success-title">Recebemos seu pedido.</p>
            <p>Nossa equipe fala com você pelo WhatsApp para marcar a demonstração.</p>
          </div>
        ) : (
          <form className="mkt-demo-form" onSubmit={handleSubmit}>
            <label>
              Nome completo *
              <input type="text" name="nome" required maxLength={120} />
            </label>
            <label>
              WhatsApp *
              <input type="tel" name="whatsapp" placeholder="(11) 91234-5678" required />
            </label>
            <label>
              E-mail *
              <input type="email" name="email" required />
            </label>
            <label>
              Tipo de negócio *
              <select name="segmento" required defaultValue="">
                <option value="" disabled>
                  Selecione...
                </option>
                <option>Empresa por assinatura</option>
                <option>Clínica ou consultório</option>
                <option>Serviços profissionais</option>
                <option>Loja</option>
                <option>Outro</option>
              </select>
            </label>
            <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="mkt-isca" />
            {status === "error" && (
              <p className="mkt-demo-error">Não deu para enviar agora. Tente de novo em instantes.</p>
            )}
            <button
              className="mkt-btn mkt-btn-solid mkt-demo-submit"
              type="submit"
              disabled={status === "sending"}
            >
              {status === "sending" ? "Enviando..." : "Agendar demonstração"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
