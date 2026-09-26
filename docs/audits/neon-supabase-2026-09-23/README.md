# Inventário de migração: Neon + Supabase Auth/Storage

Data: 2026-09-23. Fonte local: commit `cb424c3c2568845a4b5dcd7f846e2c91b14488ad`.
Estado: **análise, sem implementação ou alteração de produção**. Não foi criado projeto,
conectado banco, aplicado SQL ou alterado container nesta tarefa. Os CSVs não contêm dados de clientes.

## Conclusão

A arquitetura solicitada é viável em princípio, mas exige uma migração da camada de dados,
da autorização e do tempo real. Trocar `SUPABASE_DB_URL` divide o sistema entre dois bancos:
os consumidores `pg` passam a usar Neon, enquanto `supabase.from/rpc` continuam no PostgREST do Supabase.
Isso quebraria filas, memberships, auditoria e consistência de atendimento.

Destino proposto: dados de negócio e plataforma em Neon dedicado; identidade e arquivos no
Supabase compartilhado. Nenhuma tabela de negócio deve continuar como segunda fonte da verdade
no Supabase. Realtime requer substituição própria; não faz parte automaticamente de Auth/Storage.

## Medição reproduzível e limites

Execute, da raiz, `python3 docs/audits/neon-supabase-2026-09-23/inventariar.py`.

- 1.914 arquivos TS/TSX rastreados em app/lib/components/hooks/workers, sem testes e sem tipos gerados.
- 1.561 candidatos `.from()`, dos quais 28 identificados imediatamente após `.storage`.
- 176 candidatos `.rpc()`, 79 nomes literais distintos; argumentos dinâmicos ficam explicitamente marcados.
- 517 arquivos com candidatos `.from()`/`.rpc()`.
- Baseline: 145 nomes distintos em `CREATE TABLE`, 214 nomes distintos em `CREATE FUNCTION`.
- 162 declarações candidatas `CREATE POLICY`, incluindo SQL em strings; **não são 162 policies efetivas**.
- Superfícies: Auth em 76 arquivos, Storage em 20, Realtime/wrapper em 20, SQL direto em 48.

Inventário lexical, não compilação TypeScript nem parser SQL completo: comentários TS são removidos
por scanner leve; expressões regulares/template interpolations complexas exigem revisão manual.
Nomes criados mais de uma vez, funções substituídas, overloads, objetos removidos e DDL dinâmico
não equivalem ao catálogo final. Loops geram policies não enumeráveis por simples CREATE.
Chamadas genéricas, aliases e SQL por wrappers podem ampliar a superfície. A indicação client é
heurística: não segue o grafo transitivo de imports. Nenhum consumidor direto foi marcado client
por essa heurística; isso **não prova** ausência transitiva no browser.

O baseline é a fonte da instalação self-host; migrations históricas não devem ser somadas a ele
como se fossem objetos adicionais. Uma etapa seguinte deve aplicar baseline e prelude em banco
descartável e extrair pg_class/pg_proc/pg_policy/pg_trigger/pg_constraint/ACLs, confrontando MANIFEST,
migrations e tipos gerados. Não usar o prelude de teste como implementação de autenticação.

| Artefato | Conteúdo |
|---|---|
| [tabelas.csv](tabelas.csv) | Cada tabela encontrada, destino, linhas de criação e referências |
| [funcoes.csv](funcoes.csv) | Cada função encontrada, definições, RPCs e dependências Auth |
| [policies.csv](policies.csv) | Declarações de policies por tabela e linha |
| [chamadas.csv](chamadas.csv) | Cada candidato from/rpc, arquivo, linha e alvo |
| [superficies.csv](superficies.csv) | Pontos Auth, Storage, Realtime e SQL direto |
| [dependencias-sql.csv](dependencias-sql.csv) | Referências a Auth, Storage, Realtime e extensões |
| [views.csv](views.csv) | Views também necessárias à migração |
| [resumo.json](resumo.json) | Contagens e alvos sem correspondência literal no baseline |

## 1. Auth/Storage — permanecem no Supabase

**Auth:** login, logout, recuperação, confirmação, sessão/cookies e MFA permanecem no Auth.
Entradas: `lib/supabase/{server,browser,admin}.ts`, `proxy.ts`, `app/actions/auth/`,
`lib/auth/server.ts`, `lib/auth/provision.ts`, `app/api/v1/admin/users/route.ts`.

Separar os clientes de Auth/Storage dos repositórios de dados. `loadAuthUser` atualmente faz
`auth.getUser()` e lê `platform_admins` + `user_organizations` com o mesmo cliente;
o primeiro fica no Supabase, os dois últimos vão ao Neon. `requireRole` consulta
`fn_user_role_in_org`: essa autorização também deve ir para Neon.

No projeto compartilhado, autenticação não concede acesso ao DeskcommCRM. Exigir vínculo local
ativo no Neon; um usuário válido de outro produto deve receber acesso negado. O UUID do Auth
é a identidade externa; papéis comerciais/admin são locais. Não confiar em user_metadata para privilégios.
Não listar todos os usuários do Auth no painel CRM, nem excluir contas, redefinir MFA ou editar
metadados globais de usuários de outros produtos. Remoção do CRM deve revogar vínculo local;
exclusão global do Auth pede política coordenada com Gravity. Site URL, redirects, templates de
e-mail e provedores também são compartilhados: o instalador atual não pode sobrescrevê-los.

**Storage:** arquivos ficam no Supabase. Referências: `lib/lgpd/storage-redaction-queue.ts`,
`lib/ai/rag/ingest/documento.ts`, `lib/branding/logo.ts`, rota de avatar e rotas de mídia.
Buckets identificados por código/baseline: `whatsapp-media`, `ai-policy`, `lgpd-exports`,
`skill-assets`, `brand-logos` (este é público deliberadamente, somente para logos).
Metadados de negócio, caminhos, consentimento e fila de expurgo ficam no Neon.

Problema concreto: policies de `ai-policy`, `lgpd-exports` e `skill-assets` consultam
`public.user_organizations`; a restrição de suporte em storage.objects também chama helpers
locais. Elas não passam a consultar Neon quando a tabela muda de banco.

Estratégia proposta: acesso mediado por backend autenticado, autorização no Neon e operações
Storage no servidor. URLs assinadas curtas e uploads com caminho definido pelo servidor;
revalidar vínculo e objeto na finalização. Não aceitar bucket/path/organization_id arbitrários.
Separar buckets ou prefixos por **projeto + organização**, inclusive `platform/`, para não
colidir com outros produtos. Revisar policies existentes antes de conceder acesso direto.
Service role ignora RLS do Storage: isolamento passa a depender do gateway e do escopo de suas
operações. Não alegar que a chave compartilhada é isolada por projeto. Nunca enviá-la ao browser.

## 2. Tabelas — migram para Neon

Lista completa em tabelas.csv. As 145 criações detectadas são de aplicação (`public` e
`private.app_secrets`), não as tabelas internas do Auth/Storage.

| Domínio | Exemplos que migram |
|---|---|
| Identidade do produto/autorização | organizations, user_organizations, platform_admins, team_invites, platform_support_sessions, user_recovery_codes |
| CRM | contacts, crm_leads, crm_pipelines, crm_stages, crm_lead_activities, crm_tasks, lead_notes |
| Atendimento | conversations, messages, conversation_notes, conversation_assignment_events, demandas, passagens_de_atendimento, attendant_availability |
| Canais | channel_sessions, channel_routing_policies, channel_routing_responsibles, channel_knobs, meta_templates, voice_calls |
| IA/conhecimento | ai_agents, ai_agent_versions, ai_agent_runs, ai_chunks, ai_knowledge_sources, ai_provider_credentials, ai_budgets, llm_calls |
| Continuidade | followup_enrollments, followup_enrollment_events, followup_flow_versions, cron_jobs, job_queue, send_ledger, promise_table_versions |
| Eventos/auditoria | event_log, event_service_origins, api_audit_log, idempotency_keys, webhook_events_log |
| Agenda/integrações | calendar_appointments, calendar_connections, calendar_external_events, tenant_integrations, orders |
| Plataforma | platform_branding, platform_settings, platform_config, system_version, extension_installations, private.app_secrets |

Preservar UUIDs, organization_id, FKs, constraints compostas, índices, views, triggers e
transações. Nem toda tabela é tenant-aware: catálogos e configuração global precisam de política
própria, não adicionar organization_id cegamente. Tabelas filhas podem herdar escopo por FK.
Dados de credenciais cifradas migram sem rotacionar a chave inadvertidamente.

FKs para auth.users não atravessam bancos. Proposta: diretório mínimo de identidades locais
(por exemplo `app_users`, ainda não criado) com UUID externo, nome necessário e estado local.
Redirecionar FKs/joins para ele, preservando autoria histórica e sem copiar hashes de senha,
segredos MFA, refresh tokens ou todo o diretório global. Provisionamento/revogação/exclusão
exigem reconciliação idempotente e falha visível, pois não existe transação distribuída Auth↔Neon.

## 3. RPC/functions — migram para SQL/serviço no Neon

Não transformar cada RPC em múltiplos updates HTTP: funções que hoje garantem atomicidade
continuam em transação PostgreSQL. `pg` já existe no projeto; usar consultas parametrizadas.

| Família | Exemplos / tratamento |
|---|---|
| Tenancy/RBAC | fn_user_org_ids, fn_user_role_in_org, fn_role_at_least, fn_is_platform_admin: portar contexto e memberships |
| Visibilidade | fn_can_view_conversation, fn_can_view_lead: preservar escopo de atendente, não somente organização |
| Suporte/MFA | fn_support_context, fn_start_support, fn_session_mfa_proven: substituir joins de sessões/fatores Auth por prova confiável do serviço |
| Atendimento | fn_conversation_assign: transação, atribuição, eventos e nome hoje consultado em auth.users |
| Eventos | emit_event, fn_log_event, triggers: preservar consumidor, origem, auditoria e limites de autoridade |
| IA/RAG | retrieve_top_k_chunks, fn_buscar_trechos_das_fontes, fn_publish_ai_agent_version: portar vetores e grants |
| Agenda/follow-up | fn_appointment_change, fn_followup_claim_current, fn_followup_job_current: preservar locks e revisões |
| Privacidade/segredos | fn_lgpd_anonymize_contact, fn_encrypt_oauth, fn_decrypt_oauth: manter controle de execução e expurgo de arquivos fora da transação |
| PostgREST | fn_pgrst_recusar_replay_do_gateway: traduzir pre-request/header de replay para a nova borda; não transplantar dependência do gateway sem consumidor |

**Pendências pré-existentes encontradas:** encrypt_cpf, decrypt_cpf e jsonb_set_last_alarm_at
são chamadas no runtime, mas não foram encontradas por nome em baseline/migrations pesquisados.
O código de CPF já prevê indisponibilidade; isso não torna as RPCs implementadas. Registrar
contrato e decidir implementação/retirada do fallback durante a migração. RPCs dinâmicas
precisam resolver o conjunto de nomes antes do corte. Os alvos from sem CREATE TABLE incluem
views; ai_provider_credentials_safe não pode virar leitura indiscriminada de segredos.

Duas opções de transporte:

- Repositórios/serviços usando pg no servidor: separação explícita, mas requer converter os
  consumidores e preservar contratos PostgREST (.select com joins, single/maybeSingle, count,
  range, upsert, erros e paginação). Opção de referência para a análise.
- PostgREST próprio diante do Neon: pode reduzir alterações no query builder, mas adiciona um
  serviço na VPS, verificação JWT, grants, schema cache e pre-request. Não fornece Auth,
  Storage ou Realtime automaticamente; depende da aceitação desse serviço no padrão Gravity.

Nenhuma das opções está implementada ou escolhida definitivamente.

## 4. RLS — estratégia equivalente

Manter RLS no PostgreSQL do Neon **e** guards de aplicação, não trocar tudo por WHERE manual.
Fluxo proposto:

1. Backend valida a sessão no Supabase (`getUser`); JWT válido deve ter emissor/projeto,
   assinatura, validade e audience esperados. Expiração/revogação/MFA são verificadas pelo
   mecanismo Auth suportado. Não copiar claims decodificados sem validação para o banco.
2. Resolver no Neon a identidade local e organização autorizada. Cookie/header/body pode
   indicar uma escolha, nunca provar membership ou papel. Separar autenticação do projeto
   compartilhado da permissão neste produto.
3. Adquirir **uma conexão**, abrir transação, aplicar contexto com `set_config(..., true)`
   parametrizado, executar operações e commit/rollback antes de devolver a conexão. Nunca
   usar SET global de sessão e depois uma query arbitrária via pool.query. Não confiar que
   o pool preserve a conexão entre chamadas. Contexto sem usuário/org deve negar acesso.
4. Helpers de contexto equivalentes a auth.uid/auth.jwt recebem somente valores que o backend
   estabeleceu. Policies usam usuário + organização autorizada + papel e visibilidade atuais.
   Não basta organization_id com valor livre nem role do JWT genérico authenticated.
5. Papel de runtime separado do dono/migrations: sem SUPERUSER/BYPASSRLS, sem poder assumir
   papel privilegiado; revisar FORCE RLS e SECURITY DEFINER para não criar bypass indireto.
   Testar atributos/associações do papel efetivo, não confiar no nome dado pelo console Neon.
6. Policies preservam USING **e** WITH CHECK para CRUD, revogação, suporte readonly e
   visibilidade; nenhum RPC deve liberar acesso apenas porque auth.uid() está nulo.
7. Workers, webhooks e MCP têm contextos de serviço distintos: token/segredo validado resolve
   tenant, escopo e ator. Trabalhador global reivindica jobs com capacidade restrita, depois
   processa cada tenant em contexto limitado. Migrações usam credencial separada, fora do app.

O contexto via GUC protege contra esquecimentos de filtro, não contra um backend/credencial SQL
comprometido que possa fabricar contexto. Credencial nunca vai ao browser; endpoints não aceitam
SQL/RPC arbitrários. SECURITY DEFINER exige search_path fixo, owner controlado, EXECUTE revogado
de PUBLIC e grants mínimos. Membership, ações administrativas, audit append-only e operações
TRUNCATE precisam de controle de privilégios além de RLS.

**MFA/suporte são bloqueadores reais:** fn_support_context lê auth.sessions e auth.mfa_factors;
fn_start_support trava sessão Auth; fn_session_mfa_proven consulta fator TOTP ativo. Esses dados
não existem no Neon. Um JWT assinado com aal1 não prova ausência de fator cadastrado. Projetar
serviço de autorização que consulte Auth por meios suportados e forneça prova curta vinculada
à sessão, revalidando operações sensíveis. Se a prova estiver indisponível, negar a operação.
Não criar tabelas fake de sessões/fatores e presumir equivalência aos controles atuais.

## 5. Realtime, workers e instalação

`hooks/realtime/useRealtimeChannel.ts` assina postgres_changes e broadcast; inbox/kanban
consomem esse wrapper. A publicação supabase_realtime inclui dados hoje locais ao Supabase.
Mover esses dados para Neon não faz o Supabase compartilhado observar as mudanças.

Proposta a validar: eventos/outbox transacionais no Neon → consumidor na VPS → SSE/WebSocket
com autorização por organização **e visibilidade do registro**, retomada por cursor e refetch.
Invalidar listas pela API autenticada reduz exposição de payloads. Revogar assinatura ao
perder membership. Cobrir escritas feitas por RPC, triggers e workers; publicar antes de commit
ou só em handlers HTTP perderia eventos. Broadcast do Supabase seria opção adicional, mas
não está assumido, pois o escopo pedido mantém Supabase apenas para Auth/Storage.

`lib/agent-engine/db/pool.ts` e vários workers já usam pg, porém chamam handlers que ainda
usam SupabaseClient. O worker só pode ser apontado ao Neon quando a cadeia completa migrar.
Preservar SKIP LOCKED, advisory locks transacionais, idempotência, leases, cancelamento e
recuperação. Pooling Neon deve ser validado para o conjunto de consultas/locks; migrations
usam conexão apropriada e role de DDL. Instalar/verificar vector, pgcrypto, citext, pg_trgm e
uuid-ossp conforme catálogo efetivo e schemas esperados (public/extensions).

Não executar install.sh/update.sh atuais nessa arquitetura: aplicam baseline no Supabase,
configuram Auth compartilhado e geram variáveis assumindo um único backend. Preparar um caminho
de instalação Neon que não publique Caddy nem duplique WAHA/Redis/SRH. Não editar migrations
históricas ou database.types.ts à mão. Separar variáveis de dados Neon (runtime/DDL) das de
Auth/Storage Supabase; regenerar tipos por fontes separadas e manter backups dos dois destinos.

## 6. Fases e critérios de aceite antes de produção

1. Confirmar contrato Gravity e destino Neon; catálogo aplicado em ambiente descartável,
   classificação final das policies/functions/triggers/ACLs e extensões.
2. Prova restrita: autenticação Supabase + diretório/memberships Neon + uma leitura e escrita
   tenant-aware usando papel real de runtime e RLS.
3. Migrar serviços por domínio e RPCs atômicas, sem dual-write permanente ou cadeia dividida;
   adaptar Auth admin, Storage gateway e tempo real.
4. Provar A/B cross-tenant em leitura/insert/update/delete/RPC, usuário autenticado sem vínculo,
   troca de org, revogação, suporte readonly, admin escopado, MFA, bearer MCP e webhook.
   Repetir sob concorrência/reuso de pool/rollback; tentar operar sem contexto e com org forjada.
5. Provar negação de acesso ao Storage de outro projeto/tenant e ausência de efeitos no Auth do
   Gravity; URLs assinadas expiram e não podem ser emitidas para objetos não autorizados.
6. Provar jornada real: entrada WhatsApp → fila → IA → pausa humana → resposta → devolução à IA
   → follow-up, com timeline/realtime, auditoria e nenhum envio duplicado.
7. Corte com backup, restauração ensaiada, pausa de consumidores, IDs preservados, reconciliação
   de contagens/objetos/filas e rollback. Não reproduzir envios de jobs já concluídos.

Não foi executado teste de banco/app: Docker inacessível nesta sessão, sem Neon de teste
identificado e sem dependências instaladas. A prova atual é o inventário reproduzível e leitura
das fontes, não prontidão para migração.

## 7. Informações ainda necessárias (não bloqueiam este inventário)

- Identificador do Neon deste projeto, versão, extensões, runtime/DDL e configuração de pool
  disponíveis pelo mecanismo seguro do Gravity. Não enviar senhas no chat.
- URL/ref do Supabase **compartilhado efetivo**, não apenas a organização conectada. Os projetos
  antes listados não foram confirmados como backend Auth/Storage do Gravity.
- Contrato Gravity de identidade por projeto, membership, admin, MFA, revogação, buckets,
  prefixos, e-mails/redirects e API de provisionamento. Nenhum arquivo privado do Gravity foi lido.
- Existência de dados reais nesta instalação e necessidade de importação. Se for instalação
  fresca, não há carga histórica a migrar; o trabalho de adaptar código/schema continua necessário.

## Living System Checklist (proposta, não conformidade implementada)

Entrada: sessão/atores autenticados + eventos WhatsApp. Saída: serviços de domínio no Neon,
Storage e telas atuais. Logs: preservar event_log, api_audit_log, crm_lead_activities.
Superfície: inbox/kanban/tarefas atuais; sem nova tela nesta análise. Anti-morte: preservar
job_queue/followup_enrollments e consumidores, com reconciliação de falhas Auth/Storage.
Configuração: instalação deve validar separadamente Auth, Storage e Neon; falhas precisam de
estado visível. Continuidade: claim/pause/reactivate e funções de atribuição preservadas.
Retorno: erro deve acionar retry controlado/aviso, nunca envio duplicado. Mapa atual não foi
alterado porque a proposta ainda não existe; implementação deverá registrar as novas arestas.

## Referências externas verificadas

- [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html): owner e BYPASSRLS
  podem ignorar policies; privilégios e policies são camadas distintas.
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control):
  service key ignora RLS; exige backend confiável.
- [Neon extensions](https://neon.com/blog/ten-most-popular-postgres-extensions): suporte geral a
  extensões não prova que estejam instaladas no projeto a usar.

Complemento: [contrato Gravity e divergências verificadas](contrato-gravity.md).

Contrato aceito e gate da próxima fase: [homologação de isolamento](homologacao-isolamento.md).
