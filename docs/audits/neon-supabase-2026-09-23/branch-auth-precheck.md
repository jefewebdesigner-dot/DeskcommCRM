# Complemento: identidade da branch e preparação Auth A/B/C

Evidência sanitizada: [branch-auth-precheck.json](branch-auth-precheck.json).

## Comprovado diretamente

Consultas read-only ao pg_settings de ambas as conexões retornaram o mesmo neon.project_id,
neon.branch_id e neon.endpoint_id. O projeto corresponde a NEON_PROJECT_ID; o endpoint
corresponde ao host das connection strings normalizado sem -pooler; current_database()
corresponde ao database solicitado. O registro neon_auth.project_config aponta ao mesmo endpoint.

Projeto: green-boat-61917454. Branch ID: br-jolly-fog-b5vafsas.
Endpoint ID: ep-crimson-mode-b5cecqiz. Identificadores não são credenciais.
O database e host completos foram comparados em memória, sem publicar connection strings.

O nome amigável da branch não está no pg_settings consultado. name de neon_auth.project_config
é nome da aplicação Auth, não evidência do nome da branch. Não usar esse campo para aprovar
homologação. Sem Neon Management API key ou ferramenta Neon disponível, o vínculo
branch ID → nome homologacao permanece não comprovado independentemente.

## Como preparar os usuários reais após confirmar o destino

O Auth configurado tem email/password habilitado e não exige verificação de e-mail no login.
Não foi necessário alterar essa configuração. Isso indica um caminho de cadastro público
email/password, mas não prova sucesso de cadastro: a API ainda pode impor outras restrições.

1. Pelo mecanismo seguro Gravity, reservar identidades de teste A/B/C no Auth deste endpoint,
   evitando contas existentes e qualquer cadastro em produção. Usar emails de teste controlados
   ou aliases aprovados para esse ambiente. Não inventar JWTs nem inserir diretamente em
   neon_auth.user/account/session. Não enviar mensagens a terceiros.
2. Gerar senhas aleatórias sem saída no chat/terminal; armazenar no cofre de teste Gravity.
   Usar signUp.email e signIn.email da API/SDK oficial de Neon Auth (Better Auth gerenciado).
   Se Gravity preferir provisionar as contas, fornecer acesso de teste pelo mesmo mecanismo.
3. Obter sessão real e JWT emitido pelo serviço. Tokens ficam apenas no processo/cofre,
   nunca em query string, relatório ou commit. Fazer login de pelo menos A antes de schema.
4. Validar JWT com JWKS da configuração confiável (não jku arbitrário): algoritmo permitido,
   assinatura, emissor esperado do serviço, audience conforme contrato oficial e exp/sub.
   O sub deve corresponder ao usuário da sessão real.
5. Controle negativo: corromper a assinatura do JWT real e exigir rejeição. Para expiração,
   validar o mesmo JWT real com relógio do verificador após exp, registrando que é avanço
   controlado do relógio; não fabricar token assinado nem afirmar expiração natural medida.
6. Depois do gate pré-schema, A e B ganham memberships de organizações distintas no schema
   de prova. C permanece autenticável, sem membership. Antes do schema, nenhum deles terá
   membership de negócio; neon_auth.member não substitui automaticamente memberships CRM.

Nenhuma conta foi criada: falta identificar independentemente a branch antes de qualquer
mutação. Nenhum login/JWT real foi validado. Nenhum schema ou migration foi aplicado.

## Único bloqueio que deve ser resolvido agora

Gravity deve fornecer acesso autorizado de leitura aos metadados Neon deste projeto ou um
mecanismo verificável de consulta do vínculo endpoint → branch ID → nome homologacao.
Não precisa de outro banco, outro Supabase, nem enviar segredo pelo chat. Depois disso,
executar cadastro/login real e reportar eventual nova restrição encontrada, sem presumir sucesso.

Referências consultadas:
- https://neon.com/docs/manage/endpoints/
- https://api-docs.neon.tech/reference/getprojectbranch
- https://api-docs.neon.tech/reference/authentication
- https://neon.com/docs/auth/overview
- https://neon.com/docs/auth/guides/email-verification
