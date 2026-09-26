# Revisão de segurança — candidata 0004

Estado: **[PREPARADO]**, sem execução SQL, acesso ao host, banco ou rede. Destino:
infraestrutura de compatibilidade Neon do projeto. A candidata não habilita o
cliente administrativo e não torna o produto pronto para produção.

## Achados concretos no código

| Severidade | Fonte | Consequência |
|---|---|---|
| Crítica | `neon/migrations/20260923_0004_server_service_identity.sql:54-67` | Concede INSERT/UPDATE/DELETE em toda tabela pública com RLS e cria policy permissiva global para UUID técnico. Reabre escrita em tabelas protegidas e acesso entre organizações para aquela identidade. |
| Crítica | Mesma migration, linha 77 | `EXECUTE ON ALL FUNCTIONS` reabre RPCs administrativas para **todo usuário authenticated**, independentemente de `is_server_service()`. O baseline revoga explicitamente `fn_lgpd_cascade_redact_contact`, `fn_decrypt_oauth` e outras (linhas 31058, 32237-32246). |
| Alta | `neon/baseline.sql:24802`, `28953`, `29635` | Auditoria append-only e tabelas de mensagens/passagens restringem escrita por ACL. A 0004 ignora essas restrições ao conceder DML de volta; ter RLS não autoriza ampliar GRANT. |
| Alta | Patch antigo `neon-0004-retirar-grants-globais.patch` | Remove os GRANTs, porém mantém policy global por identidade, sem organização. É insuficiente para o contrato solicitado e não deve ser aplicado. |
| Alta | `lib/supabase/admin.ts:174-198` + `lib/neon/service-session.ts:42-84` | Todo admin client usa um JWT técnico único. Uma conta de Auth não equivale a autorização SQL administrativa. Sem bypass global, rotas/crons/RPCs dependentes permanecem bloqueados até definir capacidades explícitas. |
| Alta | `lib/supabase/admin.ts:160-168` | Compatibilidade MFA devolve lista vazia e sucesso em deleteFactor sem realizar remoção. Isso não comprova MFA e pode ocultar falhas operacionais. |
| Média | `lib/neon/service-session.ts:44-64,99-113` | Fetches sem timeout explícito; login/token podem manter `inFlight` pendente e bloquear consumidores. Renovação de 401 cobre Auth, não falha de JWT na Data API. |
| Pendente de prova | `lib/supabase/server.ts:86-128` e `lib/neon/auth-server.ts:14` | `getUser()` adaptado chama `neonAuth.getSession()` com cache de sessão de 300 s configurado. Exige teste real de revogação/expiração; o nome Supabase `getUser` não prova revalidação remota no SDK Neon. Não inferir vulnerabilidade do nome do método. |
| Lacuna de prova | `docs/audits/neon-supabase-2026-09-23/multitenant-rls-proof.json` | Evidência histórica contém flags de leitura/escrita A/B/C. Não discrimina INSERT/UPDATE/DELETE, estado persistido, ACL efetiva, SQL completo nem SHA; não certifica a candidata ou todo CRM. |

A 0001 fornece leitura de organizações/memberships e UPDATE de organização por
admin; não fornece CRUD de contatos. A 0002 seleciona roles por prefixo
`gravity_app_%`, sem uma allowlist de nomes por projeto. A 0003 concede UPDATE de
todas as colunas de organizations, sujeito à policy. Nenhuma dessas escolhas
prova que a autorização da Data API corresponde à intenção em todos os fluxos.

Os helpers `auth.uid()` diferem entre 0001 e baseline (`app.user_id`,
`request.jwt.claim.sub`, `request.jwt.claims`). A ordem real e os claims efetivos
devem ser registrados na prova, inclusive ausência de contexto e reuso de pool.
Credenciais SQL de aplicação jamais podem ser entregues aos usuários A/B/C: GUC
de claims é contexto do servidor confiável, não substituto de JWT validado.

## Escopo da candidata

`0004-safe-candidate.sql` é uma alternativa conservadora para uma 0004 **nunca
aplicada**, não reparo de ACLs já expandidas. Recusa versão registrada, cadastro,
helper antigo ou policy global existente. Se houver qualquer resíduo, parar e
preparar forward-fix a partir das ACLs/policies inventariadas. Não adivinhar quais
GRANTs anteriores eram legítimos.

O cadastro usa `(user_id, organization_id)`, FK de organização, `active=false`, RLS
habilitada e nenhuma policy para papéis comuns. Nenhum usuário é cadastrado e
nenhum helper lê esse registro para autorizar operação. O dono DDL conserva a
autoridade inerente de proprietário; precisa permanecer fora do runtime.

### GRANT/REVOKE exatos

| Comando | Razão |
|---|---|
| **Nenhum GRANT** | Não foi demonstrada necessidade segura de ampliar acesso para o cadastro nem para tabelas/RPCs do CRM. |
| `REVOKE ALL PRIVILEGES ON TABLE public.neon_service_identities FROM PUBLIC, anon, authenticated, service_role` | Retira SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER (e privilégios adicionais da versão PostgreSQL) concedidos pelo default ACL na criação. PUBLIC é origem independente; service_role não deve cadastrar suas próprias credenciais. |
| Nenhum outro REVOKE | Preserva ACLs já revisadas do CRM. A candidata não tenta reparar grants prévios desconhecidos. |

Após o REVOKE, `aclexplode` verifica que nenhuma ACL explícita foi concedida a
outro grantee que não o dono; caso um default ACL desconhecido conceda acesso a
outra role, a transação falha. A verificação de papéis efetivos ainda precisa
provar que runtime não é dono, superuser, BYPASSRLS nem membro do dono/role DDL.

**Transação única obrigatória pelo runner**: o arquivo não emite BEGIN/COMMIT,
seguindo o contrato do repositório. Não usar autocommit statement a statement.
A verificação de ACL pode falhar após CREATE, exigindo rollback de tudo. Não foi
integrada ao baseline gerado nem ao manifesto de migrations porque é artefato
de revisão não autorizado para aplicação. A promoção futura exige integrar o
gerador/baseline e manifesto correspondentes, além da prova fresh/update.

## Validação local de artefatos (sem banco)

```bash
node --test docs/audits/runtime-2026-09-24/readiness/security-candidate.test.mjs
git apply --check docs/audits/runtime-2026-09-24/readiness/neon-0004-safe.patch
```

O teste Node é **estático**. Inclui controle negativo contra a 0004 bloqueada e
mutações independentes de GRANT, função e policy permissiva. Verde não comprova
parsing pelo PostgreSQL, execução, isolamento RLS, runtime ou UX.

## Provas ainda necessárias antes de qualquer aplicação

1. Em banco descartável explicitamente autorizado, catalogar ACLs/policies e
   atributos/memberships das roles efetivas; executar a candidata em transação.
2. Provar rejeição de 0004 já registrada, resíduos parciais, default ACL estranho
   e executor runtime; confirmar rollback sem tabela/ledger parcial.
3. Confirmar ACLs/policies de tabelas/RPCs existentes byte a byte antes/depois;
   confirmar cadastro ilegível/inacessível via authenticated/anon/service_role.
4. Testar A/B/C reais, login inválido/expirado/revogado e CRUD completo via API
   de aplicação, Data API direta e SQL de role restrita. Testar tentativas de
   alterar organization_id e criar membership/identidade privilegiada.
5. Testar identidade técnica ativa e inativa: registro não deve criar bypass;
   membro sem papel adequado não ganha DML/RPC pela existência do cadastro.
6. Provar auditoria append-only inclusive TRUNCATE; negar RPCs administrativas
   aos usuários comuns; testar mensagens/passagens/tabelas de plataforma.

**[BLOQUEADO]**: habilitar runtime administrativo com segurança exige inventário
por operação de consumidor, organização confiável, privilégio/assinatura exata,
guard, política e teste negativo. Um JWT global sob `authenticated` e uma policy
global não substituem esse contrato. Não expandir privilégios para destravar
login, métricas, crons ou atendimento antes dessa análise.
