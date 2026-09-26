# Pacote de implantação — PeríciaIA

Estado: proposta de configuração e conteúdo em rascunho. Este documento não significa que
marca, funis, agentes, mensagens ou integrações foram ativados no CRM. Fonte comercial:
copy e imagens fornecidas pelo responsável pela empresa em 25/09/2026. As informações de
produto abaixo são declarações dessa fonte, não uma auditoria de funcionalidades.

## 1. Escopo do CRM da empresa

A PeríciaIA vende uma plataforma SaaS de gestão operacional para peritos judiciais,
assistentes técnicos e escritórios de perícia. Seus três pilares são gestão, inteligência
artificial integrada e ecossistema profissional. O diretório Encontre um Perito conecta
advogados, empresas e partes a especialistas.

Este CRM organiza **venda, atendimento, implantação e relacionamento com os assinantes da
PeríciaIA**. Os processos judiciais, laudos, prazos e honorários pertencem ao produto vendido;
não são o funil de vendas da empresa. O dashboard deste CRM deve mostrar clientes,
assinaturas e faturamento da PeríciaIA. Não reutilizar como indicadores reais os exemplos
comerciais do dashboard pericial (127 processos, R$ 45 mil e prazo em três dias).

Público comercial: profissionais individuais e equipes, de diversas especialidades,
incluindo perícia bancária e cálculos financeiros. Diagnóstico comercial: perfil profissional,
volume de processos, trabalho individual/equipe, ferramenta atual e dificuldade prioritária.

## 2. Marca

- Marca e nome de referência do CRM: **PeríciaIA**, conforme logo e contexto fornecidos.
  Não adicionar um sufixo ou criar outra marca.
- Referências originais: [logo](logo-original.jpeg) e [paleta](paleta-original.png).
- Cores fornecidas visualmente: azul, branco e preto. Amostra extraída do pixel (40,40)
  da paleta original: **#2F65DF**. É uma amostra da imagem, não um manual de marca oficial.
- Aplicar pela configuração de marca da organização. Marca global da instalação e tela de
  login são outro escopo, que exige identificar a instalação e a organização corretas.
- Site informado: `https://www.periciaia.com.br`. O material também cita `APP.PERICIA.IA`;
  confirmar o endereço de acesso que deve ser enviado aos clientes.

## 3. Catálogo comercial de referência

| Plano | Mensal informado | Limite de processos | Perfil descrito |
|---|---|---|---|
| Básico | R$ 99,90/mês | Até 100 | Profissional saindo das planilhas |
| Profissional | R$ 149,90/mês | Até 500 | Profissional com volume constante |
| Equipe | R$ 249,90/mês | Até 1.000 | Escritório com múltiplos profissionais |

Modalidades informadas: mensal, semestral e anual. Descontos anunciados: **17% no semestral**
e **25% no anual**. Não foram informados os totais cobrados, regra de arredondamento,
parcelamento ou cumulação; não inferir esses valores ou criar condições comerciais novas.

O material descreve, nos três planos, gestão/importação de processos, laudos e quesitos com
IA, agenda, alertas, financeiro/honorários, tarefas e Kanban, relatórios, cálculos,
contatos e equipe com permissões. Limites de usuários, créditos de IA, armazenamento,
consumo de consultas e outras diferenças ainda precisam de confirmação. Não inferir uso ilimitado.

Preços e condições devem ficar em uma única base comercial versionada; os prompts remetem
a ela. Dados de uma assinatura já contratada devem vir do gerenciador, sem sobrescrever o
valor contratado com o preço público atual.

## 4. Funil comercial proposto — sete passos

Proposta para revisão operacional, não configuração já aplicada. Exatamente um resultado de
ganho e um de perda; mapear estes papéis nas configurações do agente.

| Papel do motor | Etapa proposta | Critério e próximo passo |
|---|---|---|
| novo | Novo interessado | Contato recebido; identificar intenção e responsável |
| contatado | Conversa iniciada | Primeiro atendimento realizado; entender perfil e necessidade |
| qualificando | Diagnóstico | Levantar volume, equipe e dificuldade; registrar informação faltante |
| qualificado | Solução apresentada | Relacionar necessidade aos recursos; oferecer demonstração se desejada |
| negociando | Escolha do plano | Confirmar plano e condições oficiais; orientar contratação |
| ganhou | Assinatura confirmada | Confirmação confiável da contratação; iniciar acompanhamento de acesso |
| perdeu | Não contratou | Registrar motivo e encerrar tentativas incompatíveis |

Uma demonstração pode ocorrer durante qualificação ou negociação, sem exigir agendamento
para toda venda. Agendar somente se houver agenda operacional configurada.

**Mover um card para ganho não comprova pagamento.** O estado financeiro é independente e
vem do gerenciador. Definir com a empresa se a confirmação de contratação exige primeiro
pagamento ou admite outro evento. Cliente já existente que solicita suporte não deve ser
contado automaticamente como nova oportunidade de venda.

Vocabulário proposto: interessado, oportunidade, assinatura confirmada, não contratou.
Campos sugeridos: perfil profissional; especialidade; faixa de volume de processos; atuação
individual/equipe; dificuldade principal; plano de interesse; periodicidade; origem; próximo
passo e responsável. Os identificadores financeiros virão da integração, sem digitação de
segredos ou informações de cartão.

Motivos de perda sugeridos para aprovação: preço/orçamento; momento inadequado; recurso
necessário indisponível; escolheu outra solução; não houve interesse; outro com descrição.
Silêncio exige política de tentativas e encerramento antes de virar perda automática.

## 5. Agente comercial — rascunho

Texto proposto para o campo de instruções, ainda sem publicação:

> Você atende interessados na PeríciaIA, uma plataforma de gestão operacional para peritos
> judiciais, assistentes técnicos e escritórios de perícia, com inteligência artificial
> integrada. Converse de forma objetiva, cordial e profissional.
>
> Antes de sugerir um plano, entenda uma questão por vez: o perfil de atuação, o volume de
> processos, se a pessoa trabalha sozinha ou em equipe e qual dificuldade quer resolver.
> Relacione a necessidade aos recursos descritos nos materiais oficiais. Apresente a gestão
> integrada como valor central; a inteligência artificial é parte dessa operação.
>
> Consulte a base comercial para planos e condições. Quando houver interesse, explique o
> próximo passo de contratação disponível. Se a pessoa quiser conhecer o sistema, ofereça a
> demonstração e use a agenda quando ela estiver configurada. Se ainda estiver avaliando,
> descubra a dúvida que falta resolver e combine um retorno quando houver interesse.
>
> Diferencie quem quer assinar o sistema de quem procura contratar um perito. Para esta
> segunda intenção, explique a finalidade do diretório e use apenas o endereço oficial que
> estiver cadastrado na base.
>
> O produto auxilia o trabalho do profissional; não substitua avaliação técnica de laudos
> ou aconselhamento sobre um processo específico. Pedidos de contratação fora dos planos,
> condições não documentadas, reembolso, contestação ou divergência de cobrança precisam de
> uma pessoa responsável. Não transforme slogans sobre resultados em garantias individuais.
>
> Use mensagens curtas e uma pergunta por vez. Registre a necessidade, a dúvida pendente e
> o próximo passo combinado para que o atendimento possa continuar.

Não inclui preço duplicado, nome de ferramenta, nome pessoal fictício ou promessa de prazo.
A publicação depende de teste, canal válido, credenciais e decisão explícita do responsável.

## 6. Agente de suporte — rascunho

> Você atende usuários da PeríciaIA com tom profissional, paciente e objetivo. Identifique
> qual módulo está envolvido, o que a pessoa tentou fazer e o resultado observado. Faça uma
> pergunta por vez e use os procedimentos oficiais disponíveis na base.
>
> Ajude a localizar o próximo passo de uso da plataforma. Se houver falha sem procedimento
> conhecido, registre os passos de reprodução e encaminhe à equipe responsável. Evite
> solicitar documentos processuais completos para diagnosticar um problema de interface.
>
> Para cobrança e assinatura, use apenas informações verificadas do cliente autenticado e
> as condições oficiais. Divergência de cobrança, pedido de cancelamento, estorno, reembolso,
> mudança contratual e dificuldade de acesso não resolvida seguem para uma pessoa responsável.
> A consulta de faturamento não autoriza cobrar, cancelar ou alterar uma assinatura.
>
> Não revise conclusões periciais nem prometa resultado judicial. Quando a dúvida for sobre
> uso da IA em laudos ou quesitos, esclareça que o profissional precisa revisar o conteúdo.
> Deixe registrado o problema, o que já foi tentado e a ação pendente para continuidade.

Usar dois agentes só depois de definir equipe, divisão de responsabilidades e roteador. Uma
única recepção com triagem também pode ser suficiente na primeira implantação. Não habilitar
capacidades de cobrança, cancelamento ou envio avulso com base apenas neste texto.

## 7. FAQ inicial — respostas sustentadas pelo material recebido

| Pergunta | Resposta de referência |
|---|---|
| O que é a PeríciaIA? | Uma plataforma online de gestão para peritos judiciais, assistentes técnicos e escritórios de perícia, com IA integrada. |
| Preciso instalar um programa? | O produto é apresentado como uma plataforma acessível online. |
| O que posso organizar? | Processos, prazos, agenda, documentos, tarefas, honorários, financeiro, laudos, quesitos, contatos e equipe. |
| Serve para equipes? | O material descreve gestão de equipe e controle de permissões, com plano Equipe. Os limites de usuários ainda precisam de confirmação. |
| A IA pode ajudar com laudos e quesitos? | O material descreve editor, templates, auxílio por IA e respostas a quesitos. O profissional deve revisar o conteúdo antes de utilizá-lo. |
| Existe integração com agenda? | O material informa integração com Google Calendar para compromissos, vistorias e audiências. |
| Como funciona a contratação? | O fluxo apresentado é conversar com um consultor, escolher e contratar o plano, acessar a plataforma e importar os processos. |
| Posso conhecer antes de contratar? | O site apresenta demonstração interativa e possibilidade de demonstração ao vivo com consultor. |
| Quais planos existem? | Básico, Profissional e Equipe. Consulte a tabela comercial desta base para valores mensais e limites informados. |
| Posso encontrar um perito? | O diretório Encontre um Perito permite buscar profissionais por nome, especialidade, cidade e estado e entrar em contato diretamente. |
| Quais cálculos são apresentados? | Price, SAC, revisional, PASEP, trabalhista e verbas rescisórias, com relatório PDF descrito como auditável. |

Perguntas presentes no site **sem resposta completa fornecida**: cancelamento, procedimento e
abrangência da importação dos tribunais, garantias de segurança, limites da geração de laudos
e cobertura exata de especialidades. Não preencher essas respostas por dedução.

## 8. Afirmações a confirmar antes de usar no atendimento

- Contagem de módulos: o material usa **11** e **12**.
- Especialidades: o site usa **16+** e a descrição adicional usa **mais de 20**.
- Mais de 500 peritos, peritos ativos e presença nos 27 estados são números de marketing;
  não são contagem de clientes ou assinaturas medida pelo CRM.
- Homologação/integração Sisperjud e data de obrigatoriedade: declaração recebida, sem
  verificação documental nesta implantação; não usá-la como orientação normativa.
- “Nunca perder prazo”, “garantido”, “qualquer processo em um clique”, “único sistema”,
  “100% protegido”, “total conformidade”, “10x”, “2x” e “9 em cada 10” não são compromissos
  comerciais ou resultados individualmente demonstrados pelo material.
- Suporte 24/7, resposta em menos de cinco minutos, configuração em cinco minutos e uptime
  garantido precisam de confirmação operacional/contratual antes de virarem promessa do agente.
- Depoimentos e exemplos de demonstração não entram como registros de clientes deste CRM.

## 9. Integração com o gerenciador e dashboard da empresa

Fontes autorizadas para leitura pelo responsável:

- `GET https://www.periciaia.com.br/api/admin/billing-export`: panorama informado como vindo
  do Stripe, incluindo MRR, ARR, churn, planos, receita, renovações, pagamentos e inadimplência.
- `GET https://www.periciaia.com.br/api/admin/billing-export/v2`: fonte informada para clientes
  fora do Stripe, como PIX/AbacatePay e registros manuais, em customers/subscriptions/payments.

A credencial não pertence a este documento, ao código cliente, aos logs ou à base de
conhecimento do agente. Guardar configuração por organização no mecanismo server-only.
O dashboard lê faturamento; isso não autoriza alterações nos meios de pagamento.

Régua antes de exibir ou somar:

| Medida | Definição e cuidado |
|---|---|
| Clientes | Entidades de cliente deduplicadas por identificador confiável. Não equivale ao tamanho da lista de assinaturas nem ao total divulgado no site. |
| Assinaturas | Contratos distintos e respectivos estados. Um cliente pode ter mais de uma assinatura. |
| Ativos | Especificar se são clientes com ao menos uma assinatura ativa ou quantidade de assinaturas ativas. Definir estados incluídos conforme contrato da API. |
| Inadimplentes | Separar clientes únicos, assinaturas em atraso e cobranças vencidas. Pagamento pendente não significa atraso sem vencimento e regra definidos. |
| Receita | Pagamentos efetivamente confirmados no período, explicitando moeda, reembolsos e origem. Não equivale ao valor de assinaturas cadastradas. |
| MRR/ARR | Indicar valores fornecidos pelo upstream e sua cobertura. Não somar mensalidades a totais semestrais/anuais sem periodicidade e fórmula explícitas. |
| Churn | Mostrar período, população e denominador da fonte. Ausência de definição não autoriza inventar percentual consolidado. |
| Renovações | Eventos previstos conforme fonte; não são recebimentos garantidos. |

Não somar agregados de v1 e v2 antes de verificar sobreposição, identificadores, moeda,
unidade monetária e completude/paginação. Sem chave segura entre fontes, apresentar cobertura
separada e limitação, em vez de prometer total único. Um endpoint indisponível não deve fazer
o outro parecer visão completa. Dado ausente não equivale a zero.

O painel deve indicar origem, instante da consulta, período/fuso quando aplicável e erros.
A versão inicial não sincroniza automaticamente clientes para contatos nem altera funil
com base em cobranças: deduplicação, vínculo e regras desses efeitos são uma etapa separada.

## 10. Pendências para aplicar e ativar

- [ ] Identificar organização real da PeríciaIA e sessão administrativa autorizada.
- [ ] Aplicar o nome PeríciaIA à organização correta; definir escopo global apenas se necessário.
- [ ] Confirmar cor oficial se houver exigência de hexadecimal exato.
- [ ] Confirmar endereço oficial de acesso, demonstração e diretório.
- [ ] Definir fuso, dias/horários de IA e equipe, prazo real de resposta e escalonamento.
- [ ] Conectar WhatsApp da empresa e confirmar estado operacional, aquecimento e limites.
- [ ] Definir equipe, responsáveis, distribuição e papéis de acesso.
- [ ] Confirmar política de cancelamento, reembolso, renovação e cobrança em atraso.
- [ ] Confirmar totais semestrais/anuais, parcelamento, descontos permitidos e limites de uso.
- [ ] Aprovar etapas, motivos de perda, condição de ganho e acompanhamento pós-contratação.
- [ ] Definir follow-ups: gatilho, intervalo, máximo de tentativas, responsáveis e parada.
- [ ] Configurar IA, orçamento e base de conhecimento; conferir indexação concluída.
- [ ] Medir contratos reais dos endpoints, cobertura, unidades e duplicidade antes de consolidar.
- [ ] Testar acesso autorizado, isolamento, erro/timeout, persistência e tela desktop/mobile.
- [ ] Testar rascunhos de atendimento e só depois decidir publicação.

## 11. Ordem de implantação e roteiro de prova

1. Confirmar organização e marca pelas telas existentes; recarregar para conferir persistência.
2. Aprovar e criar funil, mapear os sete papéis e conferir ganho/perda e campos.
3. Cadastrar catálogo/FAQ; indexar documentos quando houver credencial e base configuradas.
4. Preparar agentes como rascunho e testar antes de ativar roteador ou follow-ups.
5. Conectar leitura de faturamento pelo formulário protegido; conferir estados de carregamento,
   desconectado, erro e fonte parcial, sem expor credencial ao navegador.
6. Publicar atendimento apenas após teste e decisão explícita; validar continuidade com a equipe.

Mensagens de teste propostas: “Sou perito e tenho 80 processos”; “Trabalhamos em equipe com
600 processos”; “Quero contratar um perito, não um sistema”; “Quero cancelar e ter reembolso”;
“O sistema garante que nunca vou perder um prazo?”; “Já paguei, mas consta em atraso”.
Verificar diagnóstico, consulta à base, limites das promessas e encaminhamento adequado, sem
realizar cobrança, cancelamento ou envio externo durante os testes.

## 12. Estado de entrega deste pacote

**Feito:** organização do material em proposta de implantação e preservação dos anexos originais.
**Validado neste documento:** consistência com o material recebido; nenhuma alegação técnica ou
comercial externa foi verificada por esta redação.
**Pendente:** aplicação pelas telas, confirmação das lacunas, testes de runtime e publicação.
**Bloqueado para ativação:** configuração real depende de organização/canal/equipe identificados;
este pacote não fornece essas identidades nem presume que os acessos já existam.
