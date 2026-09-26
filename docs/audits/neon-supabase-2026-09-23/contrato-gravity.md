# Complemento: contrato Gravity recebido

Fonte: relatório fornecido pelo usuário, confrontado com o checkout DeskcommCRM
`cb424c3c2568845a4b5dcd7f846e2c91b14488ad`. Análise local; nenhuma mudança de runtime/produção.
Não consultamos o repositório nem os serviços internos do Gravity nesta etapa.

## Decisões e limites

- Decisão do usuário preservada: Neon dedicado ao projeto para dados; Supabase compartilhado
  para Auth/Storage. Não reabrir escolha por Supabase como banco de negócio sem instrução nova.
- Nenhum Neon destinado ao CRM está identificado. O relatório informa zero integrações Neon
  no Gravity; não tratamos esse dado como medição local nossa.
- URL de organização no dashboard não identifica um endpoint Auth/Storage. Falta confirmar
  ref/URL do Supabase compartilhado e a natureza de cada chave. Um PAT `sbp_…` é credencial
  de Management API, não anon/publishable key para código cliente. Não copiar valores da
  integração atual para NEXT_PUBLIC_* sem validar o tipo. Nenhuma chave deve ir ao relatório.
- Preservar Gravity, Caddy 80/443 e WAHA/Redis/SRH existentes. Esta análise não depende de
  interromper ou reconfigurar nenhum deles.

## Correção verificada: provision-channel existe aqui

| Operação | Implementação neste checkout | Autenticação/contrato |
|---|---|---|
| POST /api/v1/tenants/provision | app/api/v1/tenants/provision/route.ts | Bearer TENANT_PROVISIONING_SECRET, mínimo 32 caracteres; sem configuração responde 404 |
| POST /api/v1/tenants/provision-channel | app/api/v1/tenants/provision-channel/route.ts | Bearer de capability tenant:channel; body deployment_id, display_name opcional |
| GET /api/v1/tenants/provision-channel/qr | app/api/v1/tenants/provision-channel/qr/route.ts | Mesma capability, canal vinculado ao tenant/integração/external_id |
| POST /api/v1/tenants/provision-blueprint | app/api/v1/tenants/provision-blueprint/route.ts | Capability tenant:blueprint, separada da de canal; deployment_id deve coincidir |

`/provision` devolve organization_id, api_key, provisioning_token,
channel_provisioning_token, respectivos expires_in e replay. Os tokens de capability
expiram por padrão em 900 segundos (`lib/tenants/provisioning-capability.ts`). O api_key
é distinto dos tokens de provisionamento. Tokens ficam no backend, nunca em query string.
As rotas de canal também constam em `lib/auth/public-paths.ts`, com guard dentro do handler.
Há testes adjacentes e de capability; não foram executados nesta etapa.

A ausência relatada em outro checkout/main é uma divergência de versão a investigar.
Não afirmamos que a rota esteja publicada, que main remota seja igual ou que o E2E Gravity
esteja passando. Confrontar SHAs dos dois lados e payloads/erros/renovação antes do teste integrado.

Assimetria adicional: external_id do provision aceita até 200 caracteres; deployment_id
no provision-channel aceita até 120. O contrato de integração precisa limitar IDs ao menor
limite ou corrigir explicitamente essa diferença; não basta a rota existir.
Replays de provision rotacionam a API key via rotateIntegrationApiKey: cliente precisa guardar
a nova chave e não continuar usando a anterior. Não presumir replay sem efeito em credenciais.

## Duas fronteiras de autorização diferentes

O owner/admin do Gravity decide quem administra o **projeto de software**. Não decide sozinho
quem pode ler os dados dos clientes do CRM. O backend precisa ligar explicitamente:

`Gravity projectId → instalação/banco Neon do CRM → organization_id → memberships de usuários Auth`.

Uma instalação pode ter PeríciaIA e outras empresas, portanto projectId não é organization_id.
`owner_username`/`app_usuario()` não substituem user_organizations, RBAC, suporte readonly,
MFA, visibilidade de conversas ou RLS do CRM. Username mutável não deve virar chave primária de
identidade. Se o Gravity não usa Supabase Auth para seus próprios usuários, não presumir SSO:
provisionamento server-to-server pode funcionar sem compartilhar sessão de login.

## E-mail já cadastrado no Auth compartilhado

`lib/auth/provision.ts` em ensureExternalOwnerUser cria usuário no Auth. Se o e-mail já existe,
aceita o órfão do mesmo provisionamento quando comprovado; em outros casos pode lançar
EmailJaTemContaError. No Auth compartilhado, esse caso é esperado para clientes de outro produto.

Não contornar com busca por e-mail seguida de concessão automática de admin. Definir convite
com aceite autenticado/verificação de posse e vínculo local, ou um contrato confiável de
identidade previamente verificada. Preservar recuperação idempotente, sem editar senha/MFA
ou apagar a conta global por falha parcial da criação no Neon.

## Storage: proposta de contrato, ainda não aprovada/implementada

- Namespace próprio do projeto: preferir buckets privados dedicados ao projectId e caminhos
  organization_id/... dentro deles; alternativa projectId/organization_id/... em buckets
  compartilhados somente com revisão das policies já existentes.
- O código hoje usa nomes fixos de bucket e caminhos platform/... em alguns fluxos. Introduzir
  resolvedor central de bucket/prefixo; não apenas mudar caminho em uma tela.
- Logos públicos ficam separados de mídia/documentos privados. Nunca usar bucket público
  para simplificar acesso a WhatsApp, conhecimento ou exportação de dados.
- Servidor valida projeto, membership, permissões e relação do objeto no Neon antes de assinar
  URL/fazer upload/delete no Supabase. Storage RLS atual não consegue consultar Neon diretamente.
- Sem permissões amplas a todos os authenticated do Supabase compartilhado. A service key
  continua tendo alcance global; limitar operações no gateway e proteger a credencial.

## Próximo experimento, sem produção

1. Formalizar ponte de identidade, política de usuário existente e namespace de arquivos.
2. Preparar patch mínimo de prova com Auth separado do cliente de dados e contexto RLS por
   transação; pode começar em PostgreSQL descartável, sem inventar autenticação de produção.
3. Disponibilizar Neon de homologação pelo mecanismo seguro do Gravity, com role runtime
   restrita e DDL separada. Teste final precisa desse destino real e Auth compartilhado confirmado.
4. Provar dois tenants, usuário de outro produto, revogação, pool concorrente e acesso Storage
   negado fora do escopo; só depois portar domínios e o provisionamento completo.

Não é necessário criar outro projeto Supabase. A falta do contrato/destino não impede análise
ou preparação de testes, mas impede declarar a integração implementada e homologada.
