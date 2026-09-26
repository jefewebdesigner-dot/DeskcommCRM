# Homologação dos dois primeiros clientes

[PREPARADO] Roteiro e sondas; nenhuma requisição de integração, conexão de banco, migration ou deploy foi executada nesta preparação. Destino: infraestrutura de QA do projeto; nenhum comportamento do produto foi alterado.

## A/B/C: pré-condições e execução externa

Use exclusivamente uma branch Neon descartável, app de homologação apontado a ela e dados sintéticos. Desative workers/envios externos nesse alvo: criar contatos pode disparar triggers/eventos. Não use as organizações dos clientes. O operador externo deve criar três usuários Neon Auth reais e distintos: A admin somente da organização A, B admin somente de B, C sem membership; nenhum é administrador de plataforma ou identidade técnica. Os UUIDs devem coincidir com `sub` de seus JWTs. Os tokens precisam ter pelo menos dois minutos de validade.

Os testes operam `contacts` via **Data API real, sem client admin**, e por isso exercitam RLS com os JWTs de usuário. Não são execução SQL sob owner nem simulação de claims. O alvo deve permitir CRUD próprio de contatos; ausência de privilégio/erro de schema torna o teste vermelho, não prova isolamento. O harness só aceita 403 ou conjunto vazio nos negativos; 401, 404, 500, redirecionamento, timeout e constraint não contam como autorização válida. O controle de token inválido exige 401. O preflight e o RPC de memberships evitam tratar C desautenticado como usuário isolado.

O operador externo fornece por seu mecanismo de segredos, sem gravar/colar tokens no terminal/log: `ABC_JWT_A`, `ABC_JWT_B`, `ABC_JWT_C`, `ABC_DATA_API_URL` (base REST exata usada por `NEON_DATA_API_URL`), `ABC_ORG_A`, `ABC_ORG_B`. A confirmação `ABC_DISPOSABLE_TARGET` deve ser a mesma URL normalizada. A confirmação é uma trava explícita, **não detecta automaticamente produção**. O operador verifica a branch e o host antes de preenchê-la. Nunca passar credencial de serviço ao harness.

Antes, no ambiente externo, com conexão de inspeção já provisionada via libpq e somente leitura:

```bash
psql -X -v ON_ERROR_STOP=1 \
  -v user_a="$ABC_USER_A" -v user_b="$ABC_USER_B" -v user_c="$ABC_USER_C" \
  -v org_a="$ABC_ORG_A" -v org_b="$ABC_ORG_B" \
  -f docs/audits/runtime-2026-09-24/readiness/abc-preflight.sql
```

Esperado: auth_user_exists=true para os três; active_memberships=1/1/0; expected_admin_membership=1/1/0; platform_admin=false para todos; nenhuma identidade técnica; `authenticated` sem SUPERUSER/BYPASSRLS; RLS ativa em contacts. O operador tem que inspecionar policies e ACLs, incluindo privilégios herdados e funções SECURITY DEFINER. **Não ampliar grants para conseguir passar**. Se o preflight falhar, corrigir fixtures/schema pelo processo externo autorizado antes de rodar a sonda.

Após conferir esses resultados:

```bash
export ABC_FIXTURES_VERIFIED=A-only-B-only-C-none-no-admin-no-service
node --check docs/audits/runtime-2026-09-24/readiness/abc-data-api.mjs
node --test docs/audits/runtime-2026-09-24/readiness/abc-data-api.test.mjs
node docs/audits/runtime-2026-09-24/readiness/abc-data-api.mjs
```

O terceiro comando é a integração; os dois primeiros não comprovam RLS. A sonda cria registros com UUIDs únicos; A/B criam, leem e alteram o próprio contato; cada outro ator tenta ler por id/lista, criar, alterar e excluir no tenant alheio; o proprietário relê após cada tentativa. A/B tentam transferir o próprio contato para outra organização (WITH CHECK). O finally exclui somente os UUIDs gerados e confirma ausência, exercitando a exclusão própria. Uma interrupção abrupta pode deixar fixtures: o operador deve localizar os contatos `ABC-disposable-*` e `ABC-forbidden-create` somente nesse alvo e revisar eventos gerados antes de descartar a branch. Falha de limpeza é erro, nunca sucesso.

[TESTADO] Os cinco testes locais do harness passaram: recusa sem confirmação de alvo, modelo isolado positivo, sabotagem de leitura detectada , sabotagem de WITH CHECK detectada e falha de autenticação de C recusada. Isso valida a régua do harness, **não o banco Neon**.

## API do aplicativo: superfície adicional obrigatória

JWT da Data API não é equivalente ao cookie Neon do app nem ao bearer `dsk_`. `contacts/[id]` usa sessão/`requireRole`; `contacts` contém auth dual. Portanto não reutilizar JWT Neon em `Authorization` das rotas esperando equivalência. Preparar três contextos de navegador isolados, entrar realmente com A/B/C e confirmar identidade no app; exportar cookies apenas para o runner seguro, sem anexar ao relatório.

| Operação | A→B e B→A | C→A e C→B | Controle próprio A/B |
|---|---|---|---|
| GET `/api/v1/contacts/{id}` | 404 sem dados | 403 `no_active_org` | 200 com id/org próprios |
| GET `/api/v1/contacts` com filtros de org alheia | nenhum registro alheio | 403 | contato próprio presente |
| POST `/api/v1/contacts` com `organization_id` alheio | rejeitar campo ou criar só na org da sessão; confirmar no banco | 403 e zero linhas | criar e reler após reload |
| PATCH `/api/v1/contacts/{id}` alheio | 404 e linha intacta | 403 e linha intacta | alterar e reler |
| PATCH próprio com `organization_id` alheio | rejeitar/ignorar; org original preservada | 403 | — |
| DELETE `/api/v1/contacts/{id}` alheio | 404 e linha intacta | 403 e linha intacta | contato sintético sem vínculos excluído |

Repetir modificando cookie seletor de organização, query/path/body e com sessão expirada/sem cookie. Nestes últimos casos 401 é correto, mas não substitui C válido. Ler com o proprietário e consultar no banco depois de cada tentativa; status sozinho não prova ausência de efeitos. Conferir `api_audit_log` com request-id e organização correta, sem PII. Usar fixtures distintas por método para uma falha não mascarar a próxima. Repetir para leads/funis, conversas/mensagens, agentes, bases RAG, follow-ups, arquivos/URLs assinadas e métricas. Rotas de serviço exigem filtros explícitos de organização porque RLS técnica não protege contra erro de escopo. Testar tokens `dsk_` separados apenas nas rotas que os suportam.

[PENDENTE] Este roteiro REST não é um teste automatizado executado. A sonda cobre apenas `contacts` da Data API; não garante RBAC viewer/agent, RPCs privilegiadas, storage, todas as tabelas, filtros de service client, C via app ou acesso pelo Gravity. A migration segura precisa de gates próprios de ACL/RPC além dessa sonda.

## Prova comercial pela tela

Executar separadamente para os dois tenants, com três navegadores/contextos, dados sintéticos e números de WhatsApp consentidos. Registrar SHA, versão de schema, UTC e fuso da organização, id do cenário e screenshots sanitizados; guardar traces em armazenamento privado porque podem conter cookies. Cada linha exige sucesso, vazio/carregamento e erro visível com recuperação; reload e segundo navegador confirmam persistência e sincronização. Existência das specs abaixo é somente referência, não execução nem compatibilidade Neon garantida.

| Etapa | Prova e resultado necessário | Falha/continuidade que deve ser exercitada |
|---|---|---|
| Login | entrar/sair, reentrar, recuperar senha, sessão válida no backend | senha errada, sessão expirada, C sem org; MFA se vendido como requisito |
| Organização | nome, timezone, papel e org ativa corretos | seleção adulterada, revogação de membership, isolamento A/B/C |
| Contatos | criar, editar, buscar, reload e duplicidade | validação, permissão, erro de API; `contato-salva-email.spec.ts` como referência |
| Funil | criar lead, vincular contato, mover etapa, responsável e próximo passo | conflito/reload, tenant errado; `pipelines-gestao.spec.ts` |
| Atendimento | inbound→timeline→responsável, emoji, anexo e resposta | canal offline, erro visível/retry sem duplicata; `qa-l12-inbox.spec.ts` |
| WhatsApp | parear e provar WORKING, enviar/receber com IDs reais | webhook duplicado/assinatura inválida, desconectar/reconectar, falha de mídia |
| IA | contexto/RAG da org, resposta correta, ferramenta com efeito persistido | timeout/custo/guardrail, handoff IA→humano com resumo e humano→IA com instrução; `qa-l12-agente-ia.spec.ts` |
| Automação/follow-up | gatilho real→fila→execução no horário→timeline | silêncio abre próximo passo; STOP cancela, humano pode interromper; `followup-journey.spec.ts` |
| Venda | ganho/perda e motivo, valor/moeda e histórico persistidos | ganho cancela ações incompatíveis; não confundir mudança de etapa com pagamento confirmado |
| Pós-venda | responsável, tarefa/retorno com prazo e resolução | demanda atrasada visível no Radar; não encerrar sem resolução/justificativa |
| Métricas | comparar valores com fixtures e consultas agregadas por org/fuso | denominador, período, atraso do polling, custo real, zero dados, falha visível |
| Gravity | abrir pelo ponto real de entrada e completar login→contato→reload | cookies/iframe/proxy/logout, isolamento entre contas; somente validação externa autorizada |

Living System Checklist aplicado à homologação: entrada = evento inbound e ação de usuário; saída = mensagem/lead/próxima tarefa; registro = event_log/api_audit_log/timeline; tela = Inbox/Radar; porta = navegação real; anti-morte = fila follow-up/Radar; configuração = canal/IA/horário pela tela; continuidade = ambas direções de handoff; retorno = erro visível com correção e nova execução verificada. Estes são **critérios de prova**, não afirmação de que os consumidores funcionaram. Nenhuma peça nova do produto ou mapa de arquitetura foi criado.

## Go/no-go

[BLOQUEADO] Migration de grants globais continua proibida; não promover sem revisão e testes reais de ACL/RLS/RPC em alvo descartável. [PENDENTE] Resultado do typecheck de 3 GB e build no host; browser real do Picker; compatibilidade Neon de Auth/Data API/RPC/storage/polling; workflows comerciais completos; timeout/retry/idempotência; backup e restauração comprovados; canais e IA reais dos dois tenants. O registro fornecido pelo usuário de install/patches/testes Gravity é [CONFIRMADO por relato do host], não teste repetido nesta preparação. Acesso administrativo ao host e entrada Gravity ficam com o operador externo; não são motivo para contornar permissões.
