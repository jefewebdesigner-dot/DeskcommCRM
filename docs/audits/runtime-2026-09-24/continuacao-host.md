# Continuação — executor real e correções preparadas

## Escopo e estado

Produção, PM2, Caddy e banco não foram alterados. Fonte do Gravity inspecionada: snapshot GitHub do commit be419fe, obtido por API autenticada. Não se trata do checkout vivo /root/zheus. A visão isolada dessa pasta NÃO descreve a VPS real.

## Por que esta sessão é isolada

- `server.js:2663` — `prefixoRunner`: setpriv para claude-runner antes do bwrap.
- `server.js:2669` — `argsDoCofre`: bind do único projeto, home runner e temas; `/proc` isolado por `--unshare-pid`. O resto de /root/zheus e PM2 host não é montado.
- `server.js:2767` — `vpsSpawnWrapper`: aplica esse executor à sessão; `codexDisableInnerSandbox` evita apenas o segundo sandbox, não remove o primeiro.
- Isso é uma fronteira intencional. Não desligar sandbox nem montar /root inteiro para corrigir a implantação.

## Mecanismos existentes fora do sandbox

1. `rotas/projetos-preview.js:187`: POST /api/projects/:id/auto-preview exige authMiddleware e posse/admin do projeto.
2. `servicos/preview-runtime.js:387`: autoDetectPreview chama pm2Dev.garantir no processo host do Gravity.
3. `servicos/pm2-dev.js`: detectarRunner, instalarDependenciasSeFaltar, garantir e pm2Listar administram o processo no host. `portaDoSlug('deskcommcrm')` resulta 3591; isso é porta esperada por código, não leitura do PM2 vivo.
4. `servicos/terminal-ws.js:11`: registrar expõe /ws-terminal com verifyToken e papel admin conferido por loadUsers. Abre PTY fora do bwrap, mas na VPS ainda como claude-runner; isso NÃO assegura privilégio sobre PM2 root.
5. `rotas/admin-painel.js:263`: GET /api/admin/logs protegido por adminMiddleware.

Nesta sessão GET /api/projects retorna 401. Não foi disponibilizada sessão autenticada do Gravity para usar as rotas administrativas. Não forjei token, não procurei segredo de assinatura, não contornei o sandbox e não iniciei outro PM2.

Correção operacional necessária: aplicar o patch pelo contexto administrativo do host e acionar o auto-preview autenticado já existente. Para a IA operar diretamente, o Gravity precisa delegar uma operação autorizada do projeto ao serviço já existente; não basta desativar sandbox interno do Codex ou fornecer tokens GitHub/Neon. Não foi criado outro executor ou endpoint.

## Correção preparada do Gravity

Arquivo: gravity-be419fe-dependencias.patch.

- packageManager e lockfile precedem runner legado salvo no cadastro. Antes, `runner: npm` ganhava de pnpm declarado.
- pnpm com lockfile usa install --frozen-lockfile.
- node_modules vazio/parcial não significa instalação concluída. Checa dependências declaradas e fingerprint de manifest/lock/.npmrc.
- Deduplica instalação por caminho dentro do processo Gravity.
- Falha de leitura/JSON retorna erro estruturado.
- Não repassa stderr bruto do instalador para resposta/log.
- Preview local compartilha o detector de runner.

Testes: node --test testes/pm2-dev.test.js: 9/9; contra arquivo original, 4 falhas. node --check nos dois serviços passou. QA independente confirmou correções. Teste completo de preview não executou por falta de async-mutex no snapshot.

Limites: fingerprint não detecta corrupção arbitrária interna de pacote; Map não coordena múltiplos processos Gravity; serviço já respondendo pode retornar antes de checar atualização; health atual aceita HTTP500 como processo vivo. Não declarar saúde funcional com base nisso. Não alteramos política de descarte de outros dev servers nem executamos garantir em produção.

## Correção preparada do CRM

Arquivo: deskcomm-react19.patch.

Remove @emoji-mart/react 1.1.1 e usa emoji-mart 5.6.0 diretamente em adaptador React local com montagem/limpeza por efeito. Mantém importação lazy e propriedades do seletor. Lockfile regenerado pelo pnpm 9.15.9 em cópia temporária, sem --force/--legacy-peer-deps; diff de lock pequeno (3 inserções,14 exclusões).

Validado: resolução de lockfile e git apply --check no checkout. NÃO validado: renderização do seletor, StrictMode, typecheck/build, login ou aplicação real. Resolução ainda avisa peers transitivos Better Auth e TypeScript/Triplit; não tratá-la como build aprovado.

Arquivos existentes do checkout estão mapeados com dono nobody, e tentativa normal de escrita do package.json falhou EACCES. Foram preparados patches em vez de substituir arquivos de runtime sem administrar o processo vivo. Não ficou componente órfão no código.

## Segurança — migration ainda bloqueada

Arquivo: neon-0004-retirar-grants-globais.patch, proposta NÃO aplicada.

0004 cria identidade técnica e helper auth.is_server_service, políticas para identidade técnica e grants globais de DML em tabelas RLS, além de EXECUTE global nas funções públicas. RLS não justifica conceder UPDATE/DELETE em auditoria append-only; SECURITY DEFINER pode contornar RLS.

A proposta remove o GRANT global de EXECUTE e a ampliação indiscriminada de DML, preservando ACLs explícitas do baseline. Mantém apenas o grant explícito do helper e uso do schema que já constavam na migration. Não concede RPC administrativa a authenticated. Qualquer RPC de serviço adicional precisa de allowlist de assinatura, guard da identidade técnica e testes; não há claim de migration pronta para aplicar.

Validado: git apply --check. Não reaplicado schema e não executadas funções mutantes.

## Bloqueio e próximos gates

Bloqueio real: falta de sessão/capacidade administrativa delegada do Gravity, não ausência de /root/zheus no host nem necessidade de VPS nova. Com acesso administrativo: confirmar PM2 cwd/runner/porta/logs; aplicar correções revisadas ao checkout correto; instalar com pnpm; reiniciar SOMENTE CRM; exigir HTTP funcional; testar login e A/B/C; corrigir/aplicar grants mínimos apenas após prova; validar contatos, funil, atendimento, automações e proxy Gravity. Verificar unidade de startup do PM2 e dump: pm2 save sozinho não prova reboot automático.

Não houve commit no repositório Gravity vivo nem deploy. Patches são artefatos revisáveis, não código instalado. Não há evidência nova de fluxo ponta a ponta ou inicialização automática.
