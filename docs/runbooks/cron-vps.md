# Crons e worker do CRM em produção (Vercel + VPS)

Produção roda o app na **Vercel**; o `vercel.json` só agenda 2 jobs diários. O que o serviço `scheduler` do
`docker-compose.prod.yml` faz no self-host é feito, aqui, por **dois relógios da VPS** (custo zero):

| Peça | Como | Quem manda |
|---|---|---|
| `agent-worker` (consumidor único do dispatch de IA, fila de jobs, resgate de `queued`, espelho de sessão) | PM2 `crm-worker` (`ecosystem.config.cjs` em `/root/crm-worker`), código do `main`, env em `/root/crm-worker/.env` (0600) | PM2 (restart com backoff exponencial, boot via `pm2 save`) |
| Crons HTTP (`/api/v1/cron/*`) | crontab da VPS → `scripts/cron-vps.sh <job>` (lista fechada, segredo em `/root/.deskcomm-cron-secret`, log só com job/status/ms em `/var/log/deskcomm-cron.log`) | cron |

O worker importa `sendMessageHandler` **no mesmo processo** (ledger de envio + guardas + `getAdapter`): não há
caminho direto `worker → transporte` que contorne guarda. O worker usa a role restrita de aplicação
(`DATABASE_URL`); a URL do dono (`MIGRATIONS_DATABASE_URL`) **não** entra no env dele.

## Classificação dos jobs

`M` só manutenção · `E` pode enviar mensagem ao cliente · `C` altera CRM · `X` chama integração externa.

| Job | Classe | Situação |
|---|---|---|
| `event-log-drain` | M | **ativo** (1/min) |
| `routing-worker` | C | **ativo** (1/min) — atribuição de conversa, não envia |
| `recover-stuck-messages` | M/C | **ativo** (1/min) — marca `sending` velho como falha; **não reenvia** |
| `channel-health` | X/C | **ativo** (5/5 min) — consulta a Evolution e abre aviso interno |
| `snooze-watcher` | C | **ativo** (5/5 min) — reabre conversa adiada e cria aviso interno; não envia |
| `webhook-log-retention` | M | **ativo** (5/5 min) |
| `storage-redaction` | M | **ativo** (5/5 min) |
| `handoff-devolucao` | C | **ativo** (5/5 min) — devolve conversa ao agente após silêncio; não envia por si |
| `agent-dispatcher` | — | no-op aposentado (o worker é o consumidor) — **não agendar** |
| `followup-flow-worker`, `followup-sem-agente` | **E** | **retido** — follow-up comercial |
| `contact-birthdays` | **E** | **retido** — parabéns automático |
| `lead-date-field-due` | **E** | **retido** — automação por data do funil |
| `agenda-reminder` | **E** | **retido** — lembrete ao cliente |
| `contact-avatars`, `contact-phones` | X | retido até haver canal (chamam o transporte) |
| `contact-proposals-watcher`, `risk-watcher`, `case-stale-watcher`, `canal-mudo-watcher`, `agenda-expira-pendentes` | C | retido (avisos internos; ligar com a operação real) |
| `lgpd-sla-watcher`, `data-retention`, `kb-conversations-batch`, `sync-model-catalog` | M/X | retido (diários; custo de IA/HTTP externo) |
| `agenda-google-push/refresh/sync` | X | já na crontab existente — **não duplicar** |
| `agenda-operational-watcher`, `periciaia-billing-sync` | C/X | já no `vercel.json` — **não duplicar** |
| `periciaia-legacy-crm-import` | C | manual, nunca agendado |

Ligar um job retido = acrescentá-lo à lista do `case` em `scripts/cron-vps.sh` **e** à crontab, só depois da
liberação explícita. Nenhum job `E` roda enquanto a operação real não for liberada; o modo de teste por canal
(`metadata.ai_gate = allowlist/pre_go_live`) continua valendo e o bloqueio de `importacao_legado` sem
`campanha_liberada` é estrutural (portão único em `lib/agenda/efeito.ts`).

## Observabilidade

`GET /api/v1/health` traz `agent_worker`: `ok` (batimento < 2 min e fila em dia), `degraded` (nunca registrado
ou job pronto há > 2 min sem ser pego), `down` (sem batimento > 2 min → `unhealthy`). O detalhe inclui idade do
último batimento, último erro **já sanitizado** (e-mail, telefone e token redigidos), jobs pendentes e idade do
mais antigo. O batimento é `fn_agent_worker_beat` (migration 0346), a cada 30 s.

## Operação

```bash
pm2 status crm-worker
pm2 logs crm-worker --lines 50
# atualizar para o main:
git -C '/root/Zheus AI Projects/deskcommcrm' fetch origin main && git -C /root/crm-worker checkout --detach origin/main && pm2 restart crm-worker
```
