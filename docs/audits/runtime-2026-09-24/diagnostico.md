# Diagnóstico parcial da implantação — 2026-09-24

Checkout inspecionado: `/root/Zheus AI Projects/deskcommcrm`, HEAD `22bdd0a`.
Nenhuma migration, alteração de dados, restart ou modificação do Gravity executada.

## Evidências medidas

- `packageManager`: pnpm 9.15.9; lockfile presente: pnpm-lock.yaml; package-lock.json ausente.
- React instalado/declarado: 19.3.0. @emoji-mart/react 1.1.1 declara peer React `^16.8 || ^17 || ^18`.
- Reprodução isolada, sem modificar dependências do checkout: npm install --dry-run --ignore-scripts --package-lock=false com esses dois pacotes terminou em ERESOLVE com esse peer incompatível. A versão publicada consultada de @emoji-mart/react continua 1.1.1.
- npm dry-run no checkout falhou primeiro em EUNSUPPORTEDPROTOCOL (`catalog:`). Os logs originais do Gravity não estão disponíveis para correlacionar cada tentativa histórica.
- node_modules está desatualizado: @neondatabase/neon-js declarado e travado no lockfile, mas ausente da instalação local.
- pnpm frozen/offline pediu reconstrução de node_modules; operação não confirmada para evitar remover dependências de processo possivelmente ativo antes de identificar seu comando.
- DATABASE_URL e MIGRATIONS_DATABASE_URL conectam. Runtime: SUPERUSER/CREATEDB/CREATEROLE/BYPASSRLS falsos. Role de migrations: CREATEDB/CREATEROLE/BYPASSRLS verdadeiros, SUPERUSER falso.
- Catálogo: 148 entradas information_schema.tables públicas; 145 tabelas ordinárias em pg_class, 144 com RLS. Contagens distintas por incluírem tipos de objetos diferentes; não são prova de isolamento.
- Ledger registra 0000_full_baseline_neon, 0001_identity_tenancy, 0002_auth_compat_grants e 0003_data_api_grants (prefixo 20260923). Não registra 0004_server_service_identity.
- NEON_AUTH_COOKIE_SECRET, NEON_SERVICE_USER_ID, NEON_SERVICE_EMAIL, NEON_SERVICE_PASSWORD e NEON_DATA_API_URL presentes no ambiente, além das conexões. Presença não prova validade/login.
- HTTP real: Gravity 127.0.0.1:3333 retorna 200; candidatos /api/v1/health: porta 3591 timeout 10s, 5173 HTTP 504, 5174 HTTP 404. Não foi possível atribuir definitivamente essas portas ao processo do CRM.

## Revisão independente

Migration 0004 contém GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated. Isso reabre funções SECURITY DEFINER que o baseline restringe, incluindo fn_claim_due_followup_enrollments e fn_expurgar_auditoria_vencida. Consulta do catálogo confirmou EXECUTE=false para authenticated em ambas: o risco dessa migration ainda não foi introduzido nessas ACLs. Não executar essas funções como teste, pois têm efeitos globais.

Worker usa pool SQL; é necessário provar contexto de identidade e RLS nesse caminho, não somente conexão. package.json db:migrate é TODO com saída zero: não comprova aplicação de schema.

## Bloqueio operacional

A sessão vê /root/zheus apenas com themes, sem checkout Git. O PM2_HOME informado não existe no filesystem acessível e seu rpc.sock está inacessível. A árvore de processos começa em bwrap e não mostra os processos host. Não iniciar outro daemon PM2.

Necessário disponibilizar por mecanismo autorizado do Gravity acesso ao checkout /root/zheus e à administração/logs do PM2 host. Isso permitirá identificar cwd, porta, comando, logs originais, corrigir seleção do gerenciador pnpm e validar reinício/persistência sem afetar outros serviços. Não é necessário contratar VPS ou criar backend.

## Ainda não validado

Boot real do CRM, login, membership, isolamento A/B/C e concorrência, Storage por tenant, contatos, funil, atendimento, automações, acesso incorporado no Gravity, desktop/mobile e reinício PM2/VPS. Não há correção de runtime entregue nesta etapa. Nenhum segredo foi registrado neste relatório.
