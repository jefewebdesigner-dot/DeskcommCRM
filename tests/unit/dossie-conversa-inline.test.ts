import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * O dossiê do negócio trazia a conversa como um LINK para o Inbox: a pessoa lia,
 * respondia, e tinha que voltar ao funil para continuar — perdendo o lugar a cada
 * contato. O contrato novo: a conversa inteira (histórico + caixa de envio) mora
 * DENTRO do dossiê e do painel de tarefa, e a etapa se muda por um seletor, não só
 * arrastando.
 *
 * São testes de fonte porque o defeito original era exatamente "a tela não monta
 * o bloco": um teste que só exercitasse o componente solto ficaria verde com a
 * tela como o usuário a encontrou.
 */
const dossie = readFileSync("components/kanban/LeadDossier.tsx", "utf8");
const tarefa = readFileSync("app/app/tasks/_components/DetalheDaTarefa.tsx", "utf8");

describe("dossiê do negócio", () => {
  it("monta a conversa inline com o id da conversa do lead", () => {
    expect(dossie).toMatch(/<ConversaInline\s+conversationId=\{lead\.conversa\.id\}/);
  });

  it("não leva mais a pessoa para outra página para conversar", () => {
    expect(dossie).not.toMatch(/\/app\/inbox/);
  });

  it("a aba da conversa vem antes da linha do tempo", () => {
    expect(dossie.indexOf("<ConversaInline")).toBeLessThan(dossie.indexOf("<LeadTimeline"));
  });

  it("negócio sem conversa ainda tem como começar uma", () => {
    expect(dossie).toMatch(/<WhatsAppDoDossie/);
  });

  it("muda a etapa por seletor, usando as etapas e os negócios do funil", () => {
    expect(dossie).toMatch(/<MoverDeEtapa[\s\S]*?stages=\{stages\}[\s\S]*?leads=\{leadsDoFunil\}/);
  });
});

describe("painel de tarefa", () => {
  it("mostra a conversa inteira quando a tarefa tem conversa", () => {
    expect(tarefa).toMatch(/<ConversaInline\s+conversationId=\{conversationId\}/);
  });

  it("deixa concluir a tarefa sem sair do painel", () => {
    expect(tarefa).toMatch(/Concluir tarefa/);
    expect(tarefa).toMatch(/aoConcluir\(tarefa\)/);
  });

  it("só oferece a caixa de texto avulsa quando AINDA não há conversa", () => {
    // Com conversa, o envio é o da própria conversa (ConversaInline); duas caixas de
    // envio na mesma tela fariam a pessoa escolher entre elas.
    expect(tarefa).toMatch(/\{!conversationId \? \(/);
  });

  it("permite mover o negócio de etapa a partir da tarefa", () => {
    expect(tarefa).toMatch(/<MoverDeEtapa/);
  });
});
