# Retomada da validação de login Neon

Escopo: núcleo (configuração do cliente Neon durante SSR) e infraestrutura de testes da homologação. A correção de runtime em
`lib/supabase/server.ts` já existia ao retomar: `signInWithPassword` usa o usuário
retornado por `neonAuth.signIn.email`, sem reler a sessão na mesma requisição.

## Alterações

- Guarda exige hosts completos de banco, Auth e Data API da homologação; domínios
  que apenas imitam o prefixo são recusados. O opt-in continua obrigatório.
- Teardown revalida o ambiente antes de apagar as fixtures.
- Vitest exclui `tests/e2e-neon`, que pertence ao Playwright separado. A configuração
  do Supabase local não foi alterada.
- Teste unitário reproduz login aceito com sessão ainda ausente e preservação de
  erro de credenciais.
- Smoke exige recarregar a página protegida, consultar a API de contatos e anexar
  screenshot, além da saúde do backend e estilo da tela de login.

## Medições

- Vitest direcionado: 14 casos passaram em três arquivos.
- ESLint dos arquivos alterados: passou.
- Smoke original: 3/3 passaram, com criação e remoção de A/B/C.
- Prova mais rigorosa com destino padrão: chegou a `/app`, renderizou navegação,
  mas não concluiu o redirecionamento em 20 segundos; área central vazia na captura.
  Isso não foi classificado como falha de credencial nem como fluxo comercial validado.
- A prova de persistência passou a usar o destino explícito `/app/contacts`, para
  separar autenticação do carregamento da página inicial. Revelou a tela "Algo deu errado" após recarregar.
- Trace identificou `[neon/browser] NEON_AUTH_BASE_URL ou NEON_DATA_API_URL ausentes`.
  `AuthProvider` chama `createClient()` durante SSR, quando não existe `window`.
  O adaptador agora lê as duas URLs públicas de runtime no servidor. No navegador,
  continua usando `window.__PUBLIC_ENV__`. Nenhuma credencial adicionada ao payload.
- Diagnóstico temporário mediu autenticação + auditoria em aproximadamente 1,8 s;
  a falha posterior estava na renderização. Instrumentação removida.
- Typecheck completo: abortou com heap out of memory (exit 134). Build e suíte
  integral não comprovados. Não aumentar carga da VPS como substituto de evidência.

## Living System Checklist

Entrada: endpoints do ambiente de homologação e credenciais sintéticas de
`fixtures-abc.ts`. Saída: setup/teardown e casos de `smoke.spec.ts`. Registro:
reporter Playwright, falhas e screenshot anexado. Superfície: login e contatos no
navegador, acessados pelo login com destino explícito. Configuração: arquivo
`playwright.e2e-neon.config.ts` e opt-in, com erro explícito se o ambiente divergir.
Anti-morte: teardown remove fixtures após o teste; falha interrompe a validação.
Continuidade IA/humano: não aplicável ao harness, que não envia mensagens nem
altera atendimento. Retorno: falha de regressão impede declarar a prova concluída.
Mapa: nenhuma peça de runtime adicionada; ligações existentes login → adaptador →
Neon Auth permanecem. Nenhum schema ou deploy alterado.

## Resultado após a correção de SSR

`E2E_NEON_HOMOLOG_CONFIRMADO=1 pnpm exec playwright test -c playwright.e2e-neon.config.ts`:
**3/3 passaram em 39,1 s**. Inclui login real pelo formulário, destino Contatos,
recarga com sessão mantida, heading visível e GET autenticado de contatos com HTTP 200.
Setup e teardown concluíram; as duas organizações e os três usuários sintéticos
foram removidos. ESLint dos arquivos alterados e `pnpm release:conferir` passaram.

Checklist do conserto de runtime: entrada = URLs públicas de runtime no servidor;
consumidores = `AuthProvider` e demais chamadas do cliente compartilhado;
porta = login → Contatos; registro = auditoria de login existente e boundary de erro
existente; configuração = endpoints provisionados, sem variável nova; continuidade
IA/humano e follow-up não se aplicam à resolução de configuração. Retorno = teste
unitário de SSR e smoke com recarga detectam a regressão. Arquitetura conserva
as arestas AuthProvider → cliente Neon → Auth/Data API.

Limites: isto não comprova isolamento A/B/C, criação de contato, funil, atendimento,
automações ou instalação fresca. O smoke inicial que apenas saía de `/login` não
provava a renderização do destino; foi substituído pela prova mais forte acima.
O timeout maior do caso considera o servidor dev existente; não é medição de SLA.
Nenhum commit, deploy, reinício de servidor ou mudança de schema nesta retomada.

Prova final adicional: caso de login repetido com estado vazio carregado
("Nenhum contato ainda"), passou em 31,4 s incluindo setup/teardown.
Captura: [Contatos após login e recarga](neon-login-contatos.png).
