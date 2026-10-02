-- 0013: índice único (organization_id, platform) em ad_insights_connections
--
-- Bug real medido em produção (PeríciaIA): salvar o token de Meta Ads em
-- Configurações → Meta Ads devolvia "Não consegui gravar agora" sempre, em
-- toda tentativa. Causa: `updateAdInsightsConnection.ts` faz
-- `.upsert(valores, { onConflict: "organization_id,platform" })`, e o
-- próprio comentário do arquivo diz "o índice único (organization_id,
-- platform) da 0214" — mas essa migration nunca chegou a este banco Neon
-- (a tabela existe, sem o índice). Sem o índice/constraint casando o
-- `onConflict`, o Postgres recusa com 42P10 ("there is no unique or
-- exclusion constraint matching the ON CONFLICT specification"), e o
-- Server Action devolve o erro genérico `erro_ao_gravar`.
--
-- Idempotente: `if not exists` cobre reaplicação em update.sh.

create unique index if not exists ad_insights_connections_org_platform_key
  on public.ad_insights_connections (organization_id, platform);
