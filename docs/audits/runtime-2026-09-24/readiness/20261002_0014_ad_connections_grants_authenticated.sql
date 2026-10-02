-- 0014: grants de authenticated ausentes em ad_insights_connections e ad_platform_connections
--
-- Bug real medido em produção (PeríciaIA): salvar o token de Meta Ads falhava
-- com "permission denied for table ad_insights_connections" (42501) mesmo
-- depois da 0013 (índice único). Causa: a role `authenticated` nunca recebeu
-- GRANT nenhum nesta tabela — nem INSERT, nem SELECT, nem UPDATE — então a
-- política RLS (service_identity_bypass, já correta) nunca chega a ser
-- avaliada: o Postgres recusa no nível de ACL da tabela, antes da RLS.
-- Toda tabela do baseline recebe esses grants por padrão (ver o default ACL
-- do schema `public`); estas duas tabelas nasceram numa migration posterior
-- que não o reproduziu. Mesma lacuna em ambas — `ad_platform_connections`
-- (irmã desta, usada pelo módulo de conversões/Google Ads) tem o mesmo
-- vazio, medido na mesma consulta.
--
-- Os privilégios replicam exatamente o padrão já em vigor em
-- `ai_provider_credentials` (tabela equivalente — credencial de org, sem
-- SELECT direto para authenticated, leitura sempre mediada pela aplicação).

grant insert, update, delete, references, trigger, truncate, select
  on public.ad_insights_connections to authenticated;

grant insert, update, delete, references, trigger, truncate, select
  on public.ad_platform_connections to authenticated;

-- SELECT entrou numa segunda rodada: o primeiro apply bateu em
-- "permission denied" ainda, porque INSERT ... ON CONFLICT DO UPDATE ...
-- exige SELECT na tabela (o Postgres precisa ler a linha em conflito).
-- `ai_provider_credentials`, a referência original, também não tem SELECT
-- para authenticated — mas essa tabela nunca faz upsert com DO UPDATE pela
-- Server Action (só INSERT simples), por isso o vazio lá nunca apareceu.

-- Terceira rodada: com tabela liberada, o erro seguinte foi "permission
-- denied for function fn_encrypt_oauth" — mesma lacuna, uma camada abaixo.
-- `fn_encrypt_oauth`/`fn_decrypt_oauth` (SECURITY DEFINER, cifram/decifram
-- com a chave privada da instalação) nunca tiveram EXECUTE concedido a
-- `authenticated`. Isso também explica por que a verificação de HMAC do
-- webhook WAHA ([token]/route.ts) sempre caía no fallback `sessionSecret =
-- null` — o `fn_decrypt_oauth` ali está num try/catch que absorve o erro,
-- então nunca travou a ingestão, só desligou a checagem de assinatura (que
-- já era opcional nesta instalação).
grant execute on function public.fn_encrypt_oauth(text) to authenticated;
grant execute on function public.fn_decrypt_oauth(bytea) to authenticated;
