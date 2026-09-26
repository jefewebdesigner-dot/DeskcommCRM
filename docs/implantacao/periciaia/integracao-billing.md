# Integração de cobrança — PeríciaIA

Destino: integração opcional de nicho neste fork. O pacote de extensões declarativas
existente não executa código nem cria telas. Não depende de uma extensão declarativa;
o CRM comum continua funcionando sem conexão de billing.

## Porta e contrato

- Tela: `/app/assinaturas`, Análise → Clientes e assinaturas, gerente ou administrador.
- API: `/api/v1/billing-export`; GET gerente, PUT/DELETE administrador, cookie autenticado.
- `X-Organization-Id` deve corresponder à organização ativa autorizada pelo backend.
  É precondição da tela, nunca fonte de autoridade. Ausência ou divergência retorna 409.
- O token entra em PUT e nunca volta em respostas. Troca só ocorre depois de validar
  ambas as fontes. A tabela guarda apenas cifra, organização e data; nenhum snapshot de clientes.
- GET busca novamente as fontes e retorna `Cache-Control: private, no-store`.
  Falha parcial preserva a fonte que respondeu; falha não vira zero.
- Endpoints de origem fixos: `https://www.periciaia.com.br/api/admin/billing-export`
  e `/v2`. Bearer só em header, redirects recusados, timeout de 20 segundos e corpo
  limitado a 10 MiB por fonte. Campos são validados por Zod antes da normalização.

## Régua

v1 informa valores monetários em reais; o adaptador converte para centavos. v2 já
informa unidades menores. Esta versão aceita apenas BRL no v2, recusando fonte com
outra moeda em vez de exibir um valor incorreto.

MRR/ARR, clientes ativos, atrasos e churn são os agregados informados pela origem.
O denominador de churn não é fornecido. Não há total de clientes únicos entre Stripe
e v2: v1 não envia o cadastro completo. IDs v2 são compostos por provedor e externalId.
Não se somam clientes ativos v2 e assinaturas ativas Stripe. Gráfico histórico é somente
Stripe; pagamentos operacionais v2 não constituem extrato completo. MRR em risco
não equivale ao saldo de dívida. Datas na tela usam America/Sao_Paulo; generated_at e
fetched_at tornam o momento da informação visível.

## Instalação Neon e proteção

O código usa `DATABASE_URL` restrita no runtime, nunca `MIGRATIONS_DATABASE_URL`.
Um pool limitado abre transação e define `app.billing_export_org` como configuração
local, depois usa filtro explícito organization_id. RLS compara o mesmo contexto;
COMMIT/ROLLBACK removem o contexto antes de devolver a conexão ao pool.

`scripts/neon/instalar-billing-export.ts --apply` instala a migration canônica
`supabase/migrations/20260925120000_0344_billing_export_module.sql`, chama o provisionador
fixo e concede DML **somente nesta tabela** à role de DATABASE_URL. Confere que runtime
não é owner, authenticated, anon, service_role, superuser nem BYPASSRLS. Runtime e DDL
precisam apontar ao mesmo banco. A função instaladora não é executável por authenticated.
Nenhuma policy global de identidade técnica é criada. O ledger Neon recebe a versão 0005.

A cifra AES-256-GCM usa chave derivada por HKDF-SHA256 de NEON_AUTH_COOKIE_SECRET,
propósito billing-export-v1 e AAD da organização. Rotação do segredo de cookie exige
reconectar o token; falha de abertura não devolve detalhes criptográficos.

O diretório `neon/` estava sem permissão de escrita para esta sessão. O espelho
Neon está preparado em `docs/audits/billing-export-neon-0005.patch`; o instalador
versionado acima usa a migration canônica e não depende desse espelho para funcionar.
Não aplicar a antiga 0004 de grants globais para ativar este módulo.

## Living System Checklist

1. Entrada: as duas exportações autenticadas, contratos em `lib/billing-export/contracts.ts`.
2. Saída: `BillingDashboardClient`, priorização humana de clientes e navegação a contatos/funil.
3. Registro: `billing_export.connected`/`disconnected` via `audit()`; sem token/metadados pessoais.
4. Visibilidade: painel mostra datas das fontes, erros e estado desconectado; audit em `/app/audit`.
5. Porta: catálogo de navegação em Análise, gerente+; backend revalida papel.
6. Próximo passo: leitura pura, sem demanda criada nem ação automática. Erro tem Atualizar/configuração.
7. Configuração: formulário no próprio painel, admin; token pode ser trocado ou removido.
8. IA/humano: não dispara agentes nem mensagens; atendimento existente continua sob suas regras.
9. Retorno: falha de uma fonte impede usar seus números; reconexão e nova consulta corrigem o estado.
10. Mapa: `docs/architecture/billing-export.architecture.json`.

Configuração da marca, funil e conexão real aguarda identificação da organização
PeríciaIA e sessão administrativa correspondente. O pacote comercial está em
`pacote-periciaia.md`; não foi publicado agente ou habilitada cobrança automática.
