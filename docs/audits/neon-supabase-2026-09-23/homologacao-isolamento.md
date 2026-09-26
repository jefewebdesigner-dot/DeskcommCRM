# Contrato aceito e matriz de homologação — isolamento

Estado: **preparado, NÃO EXECUTADO**. Contrato fornecido pelo usuário em 2026-09-23.

`GRAVITY_PROJECT_ID=3f24cdc5-7711-4a1d-ba4a-d4d7ab138f61`

O identificador acima é conhecido e não precisa ser solicitado novamente. Não é organization_id.
Uma instalação/projeto hospeda organizações A e B com usuários independentes.

## Fronteira autorizada

- Neon exclusivo de homologação: dados da prova. Nenhuma conexão de produção.
- Supabase compartilhado: autenticação real. Aguardar URL de projeto/chave fornecidas pelo Gravity.
- Sem contatos, pipeline, atendimento, WhatsApp, automações ou criação de Supabase.
- Não modificar Caddy, Gravity, serviços existentes ou configuração global do Auth.
- Esta prova não migra o baseline inteiro nem configura Storage. Não precisa de service_role
  para validar usuários que já possam autenticar; admin/Storage ficam fora deste experimento.

## Configuração pendente

| Variável | Destino / regra | Verificação nesta sessão |
|---|---|---|
| DATABASE_URL | Role runtime restrita no Neon de homologação | Ausente no ambiente do processo |
| MIGRATIONS_DATABASE_URL | Role DDL no mesmo banco; somente preparação da prova | Ausente no ambiente do processo |
| NEXT_PUBLIC_SUPABASE_URL | Endpoint real do projeto compartilhado, não URL do dashboard | Ausente no ambiente do processo |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Chave pública correspondente ao projeto Auth | Ausente no ambiente do processo |
| GRAVITY_PROJECT_ID | Valor conhecido acima; namespace do projeto | Ausente no processo, valor fornecido no contrato |

A verificação não abriu arquivos de segredos. Ausência no processo não prova ausência no cofre
ou em arquivos mantidos pelo operador. Gravity deverá injetar essas configurações no executor
seguro da prova. Não pedir senhas/URLs com credenciais no chat.

Pré-requisito adicional: três usuários de teste no Supabase compartilhado (A, B e C), sem dados
reais, com mecanismo seguro para autenticar cada um. A e B recebem membership local; C não recebe.
Não usar service_role no lugar de sessão de usuário, nem inventar JWT/UUID como prova Auth.
Se for necessário criar usuários, combinar com o responsável pelo Auth compartilhado; não
ativar signup público, mudar templates, desabilitar MFA ou redefinir contas existentes para testar.

## Desenho mínimo a implementar

Schema de prova separado, sem tabelas de negócio do CRM. Entidades:

- organizações A/B, cada uma identificada por organization_id;
- memberships vinculando auth user UUID + organization_id, com estado ativo;
- registros sentinela artificiais com organization_id obrigatório, usados apenas para CRUD.

O UUID vem de autenticação Supabase validada pelo servidor. A organização solicitada é uma
seleção sujeita a autorização, nunca autoridade suficiente. Membership é verificada no Neon
na transação. Sem vínculo ativo, negar antes de consultar dados do tenant.

Papéis DDL e runtime distintos, verificados por current_user/pg_roles e memberships de roles.
Runtime não é dono das tabelas, não tem SUPERUSER/BYPASSRLS/CREATEROLE nem poder de assumir
role privilegiada; não recebe a credencial DDL no mesmo processo do servidor da prova.
Credenciais não aparecem em logs, relatório ou browser. A fase de provisionamento encerra
antes de iniciar o processo de testes com runtime somente.

Cada operação usa conexão adquirida + BEGIN + contexto transacional parametrizado + queries
+ COMMIT/ROLLBACK na mesma conexão. Nenhuma query depende de contexto remanescente no pool.
Helpers de membership/RLS precisam evitar recursão de policy e manter grants mínimos.
Usuário sem contexto nunca equivale a serviço privilegiado.

## Matriz obrigatória

Todos os casos abaixo estão **PENDENTES**, não PASSOU.

| ID | Caso | Resultado exigido |
|---|---|---|
| AUTH-1 | Login real A, B e C no Supabase | UUID validado no servidor; sem sessão falsa |
| AUTH-2 | Token inválido, expirado ou ausente | Acesso negado antes do CRUD |
| OWN-1 | A seleciona/insere/atualiza/apaga sentinela em A | Operações permitidas e estado conferido |
| OWN-2 | B seleciona/insere/atualiza/apaga sentinela em B | Operações permitidas e estado conferido |
| CROSS-S | A lê B e B lê A, inclusive por ID direto | Nenhuma linha alheia; API nega escopo inválido |
| CROSS-I | A insere em B e B em A | INSERT rejeitado pela policy; zero linhas novas |
| CROSS-U | A atualiza B e B atualiza A | Zero linhas alteradas; conferir valores originais |
| CROSS-D | A apaga B e B apaga A | Zero linhas removidas; conferir existência |
| MOVE-U | Usuário tenta mover registro próprio para organization_id alheio | WITH CHECK rejeita mudança de tenant |
| NO-MEM | C autentica e tenta CRUD em A/B | Acesso negado por ausência de vínculo |
| NO-CTX | Query runtime sem contexto de usuário/org | Sem leitura/escrita; nunca bypass |
| REVOKE | Revogar membership de A, mantendo sessão Auth válida | Próxima operação negada |
| CONCUR | Executar CROSS-S/I/U/D nos dois sentidos simultaneamente | Mesma proteção sob concorrência |
| POOL | Alternar A/B/C com pool pequeno e conexões reutilizadas | Contexto não vaza entre transações |
| ROLLBACK | Forçar erro de A, depois usar conexão com B/C | Contexto anterior não autoriza operações |
| ROLE | Consultar atributos/owner/grants do runtime | Sem autoridade capaz de contornar isolamento |

A prova deve exercer a borda de serviço **e o banco com o papel runtime**, para não atribuir
à RLS uma negação feita apenas pelo código. No teste de banco, contexto incorreto pode ser
injetado pelo harness controlado para provar que org solicitada sem membership não basta.
Isso não é prova de login real; AUTH-1 é executado separadamente e correlacionado.

SELECT/UPDATE/DELETE filtrados por RLS podem devolver zero linhas, sem erro. O teste verifica
estado persistido, não apenas código HTTP. Operações próprias precisam passar: uma policy
que bloqueia tudo não é isolamento funcional. Leituras de controle usam DDL em processo
separado quando necessário, nunca para executar as tentativas dos usuários.

Simultaneidade deve ser comprovada por barreira de início e tarefas concorrentes aguardadas,
com múltiplas conexões; registrar quantidade de operações/conexões e repetir sob reuso de pool.

## Evidência a produzir

- SHA do código/schema da prova, horário UTC, versão PostgreSQL e identificador não secreto
  do destino; confirmar explicitamente homologação antes de aplicar DDL.
- Para cada caso: ID, esperado, observado, PASSOU/FALHOU, contagens antes/depois.
- Atores rotulados A/B/C; omitir e-mails, tokens, senhas e connection strings.
- Atributos/grants do papel efetivo, políticas e verificações de estado persistido.
- Concorrência realmente executada, erros sanitizados e resultado agregado.
- Se alguma etapa falhar, manter bloqueio das próximas fases e registrar a causa.

Evidência existente neste momento: somente verificação de presença das variáveis no processo
(todas ausentes) e documentação da matriz. **Nenhum teste de isolamento foi executado.**

Limpeza limita-se aos registros/schema de teste identificados após a prova; não remove usuários
compartilhados ou recursos de outro projeto. Qualquer fixture deve ser rastreável à execução.
