# Evolution API — transporte de WhatsApp (Baileys)

Segundo transporte de WhatsApp do CRM, ao lado do WAHA. **Não substitui o WAHA**: os dois coexistem, cada canal
(`channel_sessions`) escolhe o seu por `provider`. Um mesmo número nunca roda nos dois ao mesmo tempo.

## Arquitetura

```
Caddy (HTTPS) ── evo.<domínio> ──► Evolution API (127.0.0.1:8081)
                                     ├─ Postgres dedicado  (rede Docker privada, sem porta publicada)
                                     └─ Redis dedicado     (rede Docker privada, persistente, sem porta publicada)
Evolution ── webhook HTTPS ──► CRM  /api/v1/webhooks/channel/<token>   (cabeçalho x-gravity-webhook-secret)
CRM ── REST (apikey global, server-only) ──► Evolution
```

- Uma **instância por canal de organização** (`channel_sessions.evolution_instance_name`, único no servidor).
  Nada no adapter conhece cliente, domínio ou cobrança: quem isola tenant é `organization_id` da sessão.
- O Redis da Evolution **não é** o Redis do CRM (rate limit/idempotência). São dois serviços distintos.
- `/manager`, `/docs` e `/swagger` respondem 404 (desligados no container e bloqueados no Caddy).
- Telemetria da Evolution desligada (`TELEMETRY_ENABLED=false`).

## Versão fixada (nunca `latest`)

| Imagem | Tag | Digest usado (verificado em 2026-09-29) |
|---|---|---|
| evoapicloud/evolution-api | `v2.3.7` | `sha256:1bd8afc4a6cf48822e6cf02469aeae7bd35a12a6b616eacd1291926307f4d339` |
| postgres | `16-alpine` | `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea` |
| redis | `7-alpine` | `sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499` |

A 2.4.x exige ativação/licença e fica fora até decisão explícita. Subir de versão = trocar tag **e** digest juntos.

## Ambiente do CRM

| Variável | Para quê |
|---|---|
| `EVOLUTION_API_BASE_URL` | URL HTTPS pública da Evolution (ex.: `https://evo.<domínio>`) |
| `EVOLUTION_API_KEY` | chave global (server-only, nunca no navegador) |
| `EVOLUTION_WEBHOOK_BASE_URL` | origem pública do CRM que a Evolution chama de volta (vazio = `NEXT_PUBLIC_APP_URL`) |

Sem as duas primeiras o canal Evolution responde "não configurado" e o resto do produto segue igual.

## Como conectar um número

`POST /api/v1/channel-sessions` com `{"provider":"evolution","display_name":"..."}` e `Idempotency-Key`. A RPC
`fn_reserve_evolution_connection` reserva a linha (papel admin + MFA + idempotência), gera e **cifra** o segredo do
webhook, e o servidor do CRM cria a instância já com o webhook apontando para o CRM. O QR sai por
`GET /api/v1/channel-sessions/<id>/qr` (ou código por `pairing-code`), idêntico ao fluxo do WAHA.

## Eventos (v2.3.7, nomes reais)

`connection.update`, `messages.upsert`, `messages.update` (ACK: PENDING/SERVER_ACK/DELIVERY_ACK/READ/PLAYED/ERROR/DELETED),
`messages.edited`, `messages.delete`. O corpo não é assinado: a Evolution reenvia o cabeçalho `x-gravity-webhook-secret`
configurado na instância; a rota falha **fechada** sem segredo, com segredo errado ou com `instance` diferente da sessão.
Os eventos são traduzidos para o envelope que a ingestão comum já entende (Inbox, contato, funil, ACK, dedup por
`external_id` = `key.id` cru).

## Saúde

`channel-health` (cron) pergunta ao adapter (`fetchInstances`): `open`→WORKING · `connecting` sem dono→SCAN_QR_CODE ·
`connecting` com dono→STARTING (reconexão, sem alerta) · `close`→STOPPED · `refused`→FAILED · 404→STOPPED · 401/403→
credencial recusada (alerta próprio).

## Lacunas conhecidas (sem risco de envio em dobro)

- O resgate de mensagens `queued` (`session-reconciler`) só alcança sessões do WAHA. Para Evolution as mensagens presas
  aparecem no aviso "mensagens presas em canal que este resgate não alcança"; o reenvio automático fica para uma etapa
  própria — enviar em dobro é pior que não enviar.
- Forma exata de `messages.edited` e `getBase64FromMediaMessage` só se confirmam com evento/mídia reais (prova ponta a ponta).
- Gate de uso (`ai_gate` allowlist em `pre_go_live`) e trava `importacao_legado` valem igual aos demais canais.

## Operação e backup

Infra em `infra/evolution/` do repositório da plataforma (compose, `instalar.sh`, README). Backup: dump do Postgres da
Evolution + volume `instances` (credenciais Baileys). Volumes antigos nunca são apagados por rotina.
