# Pré-checagem 100% Neon

O contrato 100% Neon substitui as propostas anteriores de Auth/Storage no Supabase.
As análises antigas permanecem como inventário do legado, não como arquitetura aprovada.

Evidência sanitizada: [precheck-neon.json](precheck-neon.json).

## Passou

- Dez variáveis presentes no processo e no .env, sem divergência entre fontes.
- Conexões Postgres de runtime e DDL; mesmo host normalizado/database, usuários distintos.
- Runtime sem SUPERUSER, CREATEDB, CREATEROLE, BYPASSRLS, roles privilegiadas alcançáveis,
  ownership de tabelas ou CREATE em banco/schema public.
- DDL tem CREATE no banco/schema. Role privilegiada: usar somente preparação/schema;
  não repassar MIGRATIONS_DATABASE_URL ao processo runtime/frontend.
- Auth /ok HTTP 200; JWKS HTTP 200 com uma chave pública importável, mesma origem do Auth.
- HEAD do bucket assinado com SigV4 HTTP 200. Não equivale a prova de CRUD/isolamento de objetos.
- .env restrito ao dono, ignorado no git; sem valores secretos nos artefatos/saídas.

## Bloqueios antes de schema

1. O usuário informou branch homologacao, mas não há metadado de branch nas fontes verificadas
   nem acesso à Management API para cruzar endpoint, NEON_PROJECT_ID e branch. Conexão TLS
   válida e nome de database não demonstram a branch. Gravity precisa fornecer evidência
   verificável do mapeamento ou um mecanismo autorizado de consulta; nenhum segredo no chat.
2. JWKS disponível não prova um login. Falta uma sessão de teste real ou mecanismo seguro para
   autenticar A/B/C no Neon Auth e validar assinatura, issuer, audience e expiração. Não usar
   token inventado, token de outra integração, nem service account como usuário autenticado.

O UUID Gravity fornecido continua conhecido. Sua ausência nas variáveis não exige solicitá-lo
novamente; ele não pode ser confundido com NEON_PROJECT_ID ou organization_id.

Nenhum schema/migration foi aplicado, usuário criado, objeto escrito ou serviço reiniciado.
Nenhuma prova A/B/C foi executada. A exposição em um frontend construído não foi testada,
pois a aplicação legada não foi iniciada com variáveis falsas para contornar seus requisitos.
