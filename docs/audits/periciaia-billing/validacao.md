# PeríciaIA — entrega parcial da implantação, 25/09/2026

## Implementado

Painel em `/app/assinaturas`, porta no menu Análise, gerente+. Configuração admin
por organização; token cifrado AES-GCM/HKDF, nunca retornado pelo GET. APIs de origem
fixas, sem redirects, timeout e limite de resposta. Fontes e suas contagens ficam
separadas; nenhuma soma é apresentada como total de clientes únicos. Filtros de
assinaturas, pagamentos, atrasos e renovações; erro, vazio e carregamento visíveis.

O módulo foi instalado no Neon **homologacao** com o instalador versionado
`scripts/neon/instalar-billing-export.ts --apply`. Reaplicação passou. Só a nova tabela
recebe grant para a role restrita de runtime; nenhuma policy global de serviço foi
adicionada. Registro no ledger: `20260925_0005_billing_export_module`.

Material comercial e imagens preservados em `docs/implantacao/periciaia/`.
Funil e rascunhos de atendimento estão no pacote; não foram aplicados à empresa real.

## Revisão crítica e correções

Revisão independente encontrou quatro falhas antes da entrega:

1. Organização trocada em outra aba: header esperado agora é validado contra a
   organização autorizada, com 409 antes de ler/escrever/consultar as fontes.
2. Módulo não provisionado e incompatibilidade da identidade técnica Neon: instalador
   explícito e persistência por DATABASE_URL, sem depender da 0004 de grants globais.
3. Cobrança vencida aparecia só com valor pago zero: normalização preserva valor devido
   e vencimento, e a tela distingue pago de devido.
4. Moedas com unidades diferentes: contrato v2 aceita apenas BRL nesta versão.

Segunda passagem local conferiu SQL parametrizado, limpeza do contexto transacional,
rollback/release da conexão, confidencialidade de erros, guardas e tratamento de falha
parcial. E2E inicialmente falhou por seletor ambíguo e por pressupor que a Data API
retornaria 42501; o harness foi corrigido, sem afrouxar a ACL. Ele mede privilégios
diretamente antes de aceitar PGRST205/PGRST202 (objetos não expostos no schema REST).

## Evidências executadas

- Duas APIs reais consultadas com HTTP 200; respostas passaram nos schemas Zod.
  Apenas estrutura e agregados foram exibidos no diagnóstico, sem nomes/e-mails de clientes.
- `pnpm exec vitest run lib/billing-export app/api/v1/billing-export/route.test.ts
  tests/unit/navegacao-completude.test.ts tests/unit/mapas-de-arquitetura.test.ts
  --maxWorkers=1`: **6 arquivos, 170 testes passaram**.
- `NODE_OPTIONS=--max-old-space-size=4096 pnpm typecheck`: **passou**, incluindo testes.
- ESLint dos arquivos de produto/teste/instalador alterados: **passou**.
- `pnpm lint:role-rank` e `pnpm release:conferir`: **passaram**.
- `E2E_NEON_HOMOLOG_CONFIRMADO=1 pnpm exec playwright test -c
  playwright.e2e-neon.config.ts billing.spec.ts`: **2/2 passaram em 43,9 s** no último
  ciclo. Fixtures A/B/C removidas pelo teardown.

O E2E prova RLS real na role runtime (próprio registro, leitura/exclusão cruzada
negadas, WITH CHECK recusando escrita cruzada, contexto removido após COMMIT),
persistência cifrada com save/read em processos separados e ACL sem acesso de
authenticated à tabela/provisionador. Usa JWT Neon Auth real para confirmar que a
Data API não expõe os objetos. A prova HTTP exige login real, estado desconectado
real, recusa anônima e 409 para organização divergente nos três métodos.

A parte visual usa **respostas de billing sintéticas**, identificadas como tal
no código e nos clientes de exemplo. Prova filtros, abas, recarga, falha parcial e
503 com dados anteriores, em 1280 e 360 px sem overflow horizontal. **Não é prova
de conexão real salva no tenant PeríciaIA.**

Capturas: [desktop](desktop.png) · [mobile](mobile.png). Marca genérica nas capturas
é da organização sintética; não foi alterada a marca global da instalação.

## Bloqueios e limites

- `pnpm build` foi tentado e bloqueado por EACCES em `.next/trace-build`. Não é build verde.
- `pnpm test:db` foi tentado e bloqueado pela ausência de `/var/run/docker.sock`.
  As provas Neon específicas acima não substituem a suíte completa do baseline.
- `pnpm lint:channels` falha em arquivos de provisionamento de canal e allowlist
  anteriores a esta integração (`lib/tenants/provision-channel*`, rotas irmãs e
  entrada de `lib/supabase/admin.ts`). Nenhum desses arquivos foi alterado aqui.
- `neon/baseline.sql` e `neon/migrations/` pertencem a outro usuário do host e não
  permitem escrita. Espelho preparado em `docs/audits/billing-export-neon-0005.patch`,
  validado com `git apply --check`. O runtime foi instalado pelo script versionado
  usando a migration canônica 0344; patch não foi aplicado contornando permissões.
- Suíte unitária integral, lint integral e deploy de produção não foram executados.
- A organização real e a sessão administrativa PeríciaIA ainda não foram identificadas.
  Logo/cor/nome, funil, conexão real e agentes permanecem pendentes de aplicação.
  Não foram criados contatos reais, importadas assinaturas, enviadas mensagens,
  efetuadas cobranças nem publicados agentes.

Próximo passo dependente do usuário: identificar a organização no seletor do CRM e
dispor da sessão admin para aplicar o pacote pelas telas existentes. Regras de
cancelamento, horários, equipe e follow-ups continuam pendências comerciais do pacote.
