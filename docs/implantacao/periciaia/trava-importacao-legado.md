# Trava de disparo — importação histórica do PeríciaIA

**Regra:** importar é mover dados e classificação. Nunca é autorização para falar com ninguém.
A campanha de recuperação (leads antigos e cancelados) é uma etapa separada, iniciada por ação explícita.

## Como funciona

- A importação grava `contacts.source = 'periciaia_legado'`, a tag `importacao_legado` e
  `source_metadata.importacao_legado = true` (qualquer uma das três basta para bloquear). A tag é a marca
  durável; o restante do estado (id legado, assinaturas) vai em `custom_fields`, que o sincronizador não regrava.
- Quem não tem e-mail nem telefone recebe também a tag `revisao_sem_contato`. Esse bloqueio vence tudo,
  inclusive a liberação de campanha, até alguém recuperar um meio de contato válido. Não se fabrica contato.
- **Portão único dos envios proativos:** `lib/agenda/efeito.ts` (`assertAgendaEffectSupabase` e
  `assertAgendaEffectPg`) recusa com `DisparoBloqueadoError` antes de qualquer mensagem ser criada.
  Por ele passam mensagem proativa, ação `send_whatsapp_message`, ação `send_ai_message`, follow-up e texto fixo.
- `enrollFollowupFlow` recusa a inscrição (409 `disparo_bloqueado`), para não criar fila.
- Falha ao ler o contato **adia** (`leitura_indisponivel`, nova tentativa em 1 min) e nada sai (fail-closed).
- **Só o proativo é bloqueado.** Responder a quem escreveu para nós continua permitido.

## Liberar a campanha (ação explícita, depois)

A tag `campanha_liberada` no contato abre `importacao_legado`. Não abre `revisao_sem_contato`.
É tag (e não `source_metadata`) de propósito: o sincronizador antigo regravava `source_metadata`
inteiro e teria apagado a liberação e a marca.

## Prova pós-importação (medir, não presumir)

`messages` com `direction='outbound'`, `send_ledger`, `outbound_copies`, `pacing_ledger`, `job_queue` de follow-up
e `followup_enrollments` dos contatos importados: todos em zero. Baseline antes da importação: 0 mensagens outbound.

Código: `lib/leads/importacao-legado.ts`. Testes: `lib/leads/importacao-legado.test.ts`,
`lib/agenda/efeito-importacao-legado.test.ts`, `lib/followup/enroll-importacao-legado.test.ts`.
