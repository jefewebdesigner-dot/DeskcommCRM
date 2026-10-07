# Fusão PeríciaIA → Gravity CRM

Estado: **mapeada e em transição**.

## Decisão de arquitetura

A PeríciaIA **não será recriada em outro CRM**. A organização que já existe no
banco do CRM atual passa a ser o primeiro tenant vertical do Gravity CRM.

```
Gravity CRM Core
├─ Comercial
├─ Contatos / contas
├─ Inbox / WhatsApp
├─ Tarefas / agenda
├─ Billing / contratos
├─ Revenue OS
├─ Customer 360
├─ Customer Health
├─ Action Center
├─ Retention Intelligence
└─ IA / automações
        ▲
        │
PeríciaIA Vertical Pack
├─ PJe Token Ouro global
├─ ponte PJe com backend legado (temporária)
├─ adaptador de billing da PeríciaIA
├─ catálogo/regras comerciais da PeríciaIA
└─ rastreabilidade da migração histórica
```

## Invariante principal

**Não criar uma segunda organização PeríciaIA.**

A organização atual `9563e071-406b-4db2-aaa4-d08846d3267b` continua sendo a
mesma identidade operacional. A fusão troca e amplia o core, preservando a
identidade e o histórico.

Devem ser preservados:

- IDs de contatos;
- cards, funis e histórico comercial;
- conversas e sessões de canal;
- memberships e papéis de usuários;
- vínculos financeiros e IDs externos de assinatura;
- trilha de auditoria;
- configuração PJe e sua ponte enquanto o backend antigo ainda existir.

## O que vira Core

| Área atual da PeríciaIA | Destino |
|---|---|
| contatos/clientes | Customer 360 / Core |
| vendas | Comercial / Core |
| pós-vendas | Customer Success / Core |
| suporte | Inbox + CS / Core |
| inadimplência | Revenue OS + Action Center |
| cancelados/recuperação | Retention Intelligence |
| WhatsApp | Canais / Core |
| tarefas | Tarefas / Core |
| agenda/Meet | Agenda / Core |
| billing/dashboard | Revenue OS / Core |
| IA e automações | IA / Core |

A partir da fusão, melhorias nessas áreas devem ser feitas **uma vez no Gravity
CRM Core** e beneficiar a PeríciaIA e os próximos SaaS tenants.

## O que continua específico da PeríciaIA

PJe não deve virar uma capacidade genérica obrigatória do CRM. Ele fica no
Vertical Pack da PeríciaIA. O Token Ouro continua sendo configuração global da
instalação porque alimenta a operação de processos de todos os clientes da
PeríciaIA; a ponte com o backend antigo é temporária.

O domínio judicial (processos, laudos, quesitos, perícias e lógica técnica do
produto PeríciaIA) continua pertencendo ao **SaaS PeríciaIA**, não ao core do
Gravity CRM. O CRM conhece o cliente, assinatura, relacionamento, uso, suporte
e receita; não vira o produto de perícia.

## Estado dos dados já migrados

A migração histórica já levou o CRM antigo/Firebase para Neon. A documentação da
execução registra 436 contatos no CRM e 43 assinaturas ativas para 42 pessoas na
data da migração, além da reclassificação dos cards de billing.

Portanto a próxima etapa não é “importar tudo novamente”. É **reconciliar a
estrutura existente com o novo SaaS Core sem duplicação**.

## Sequência de cutover

1. Marcar a organização existente com o Vertical Pack `periciaia` em estado
   `transitioning`.
2. Fazer Customer 360/Revenue OS consumirem os dados vivos de billing da
   PeríciaIA.
3. Reconciliar contatos existentes com `saas_accounts` sem gerar novos
   contatos.
4. Fazer Customer Health e Action Center operarem sobre os mesmos clientes.
5. Trocar os funis específicos de inadimplência/recuperação por estados e ações
   do Core somente quando a equivalência estiver validada.
6. Manter PJe e bridge legado ativos durante o período de convivência.
7. Validar contagens, IDs, conversas, billing e operação diária.
8. Mudar o pack para `active`.
9. Só depois remover os bridges legados comprovadamente sem consumidores.

## Critério de conclusão

A fusão só termina quando:

- não existir segundo tenant PeríciaIA;
- as contagens antes/depois baterem;
- nenhum contato/conversa for perdido;
- billing vivo alimentar Revenue OS;
- clientes em risco chegarem ao Action Center;
- suporte e WhatsApp continuarem operacionais;
- PJe continuar funcionando;
- não houver dependência necessária do CRM legado fora dos bridges explicitamente
  temporários.

Até lá, o estado correto do pack é `transitioning`.
