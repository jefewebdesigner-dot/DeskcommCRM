# Desalinhamento entre o ledger do Neon e `neon/migrations`

Estado em **08/10/2026**, conferido contra o ledger real (`public.neon_schema_migrations`) do banco de produção.

O repositório **não reconstrói sozinho** o schema de produção: dez versões do ledger não existem em `neon/migrations/`.
Algumas foram aplicadas à mão a partir de scripts de prontidão; o schema real continua sendo a fonte da verdade.

| Versão no ledger de produção | Onde está o SQL |
|---|---|
| `20260923_0000_full_baseline_neon` | equivale a `neon/baseline.sql` |
| `20260925_0005_billing_export_module` | não localizado como SQL; ver `scripts/neon/instalar-billing-export.ts` |
| `20260925_0005_platform_branding_grants` | `docs/audits/runtime-2026-09-24/readiness/` |
| `20260926_0006_service_identity_crm_write` | `docs/audits/runtime-2026-09-24/readiness/` |
| `20260927_0007_service_identity_ai_credentials` | `docs/audits/runtime-2026-09-24/readiness/` |
| `20260927_0008_service_identity_ai_agents` | `docs/audits/runtime-2026-09-24/readiness/` |
| `20260927_0009_service_identity_bypass_geral` | `docs/audits/runtime-2026-09-24/readiness/` |
| `20260927_0010_restore_acl_after_0004` | não localizado |
| `20261002_0010_service_identity_organizations` | `docs/audits/runtime-2026-09-24/readiness/` |
| `20261002_0038_radar_janelas_operacionais` | branch de correção do radar, ainda não mesclada na `main` |

## Consequência já medida

A migração `20260923_0004_server_service_identity` criou `auth.is_server_service()`, mas **a função não existe mais em produção**
(substituída por `public.fn_neon_service_identity_ok()` e pelas políticas `service_identity_*`).
Qualquer migração nova que chame `auth.is_server_service()` falha. As migrações 0038, 0039 e 0041 do Gravity CRM
foram ajustadas para `public.fn_neon_service_identity_ok()` e provadas num Postgres descartável carregado com o schema real.

## Regra daqui para frente

Antes de aplicar qualquer migração em produção: carregar o schema real (`pg_dump --schema-only`) no harness
(`scripts/neon/rls-harness.sh`, variável `RLS_HARNESS_SCHEMA`) e rodar o instalador lá primeiro.
Não versionar o dump de produção neste repositório (ele é público).
