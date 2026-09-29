# Migração histórica do CRM antigo do PeríciaIA — 29/09/2026

CRM antigo (Firebase, projeto `saaspericia2026`) → CRM novo (Neon). Executada uma vez, em produção,
por `scripts/neon/importar-crm-legado.ts`, com backup e todos os invariantes medidos no banco.

## Resultado

| Item | Valor |
|---|---|
| Linhas de origem (usuários + leads do legado) | 468 |
| Pessoas únicas (após deduplicar) | 433 |
| Pós-vendas / Cliente ativo | 42 pessoas (43 assinaturas ativas: Stripe 7, AbacatePay 34, manual 2) |
| Vendas / Primeiro contato | 324 |
| Inadimplência e Retenção / Cancelados para recuperar | 67 cancelados + 3 sem evidência no billing vivo = 70 |
| Vencido | 0 |
| Contatos sem e-mail e sem telefone (`revisao_sem_contato`) | 14 (importados pelo id legado; inelegíveis para disparo) |
| Contatos no CRM | 436 (368 novos + 68 reaproveitados do sincronizador antigo) |
| Cards antigos de billing (69) | 68 reclassificados, 1 duplicado absorvido; nenhum won/lost em Vendas |
| Mensagens, filas, follow-ups, automações criados | 0 |
| 2ª execução | 0 operações |

## Decisões tomadas durante a execução

- **3 contatos sem evidência viva.** Criados pelo sincronizador antigo em 26/09 e ausentes hoje de Stripe,
  AbacatePay, manual e do CRM legado. Não são cliente ativo e não dá para afirmar que cancelaram: ficam com as
  tags `importacao_legado` + `revisao_billing` + `ex-cliente` (sem campanha), com `financeiro.estado = sem_evidencia`,
  e o card saiu de Vendas para Cancelados para recuperar (`source_metadata.sem_evidencia_no_billing_vivo`).
  **Revisar.**
- **1 e-mail fora do formato do banco** (lead de teste, tinha telefone): importado sem o e-mail; o original fica em
  `custom_fields.legacy.contato_invalido`.
- **1 card duplicado absorvido** (a pessoa com 2 assinaturas ativas tinha 2 cards em Vendas): os dados do duplicado
  ficam em `source_metadata.absorvidos` do card mantido e o registro completo está no backup.
- Etapas identificadas pelo NOME (o funil de Vendas mantém slugs históricos de e-commerce).

## Onde está o estado financeiro e a identidade

- `contacts.custom_fields.financeiro`: estado, TODAS as assinaturas (provedor, id, status) e `assinaturas_ativas`.
  Assinatura não é pessoa: a UI pode mostrar "42 clientes ativos / 43 assinaturas ativas" somando este campo.
- `contacts.custom_fields.legacy`: id da pessoa, ids do Firebase, etapas e funis antigos.
- Marcas de disparo em TAGS (durável): ver `trava-importacao-legado.md`. Nada foi enviado.

## Sincronizador diário (`periciaia-billing-sync`)

Reescrito sobre o mesmo planejador (`lib/billing-export/legacy-apply.ts`): ativo → Pós-vendas, vencido/cancelado →
Retenção, nunca Vendas. Provado em modo leitura sobre o estado migrado: 0 operações, 0 conflitos.

## Reverter

O backup de contatos e cards anteriores à migração está na VPS, fora do repositório e com permissão 0600:
`/root/backups/importacao-legado-antes-*.json` (68 contatos e 69 cards, linhas completas). Restaurar exige um
script de retorno (apagar os contatos/cards criados com `source = 'periciaia_legado'` e devolver os 68 + 69
registros); não existe comando pronto, de propósito: a migração é idempotente e os invariantes fecharam.
