#!/usr/bin/env bash
# Dispara UM job de cron do CRM em produção (Vercel) a partir da VPS.
#
# Por que existe: a produção roda na Vercel, cujo `vercel.json` só agenda 2 jobs diários. Os
# demais (o que o serviço `scheduler` do docker-compose agenda no self-host) precisam de um
# relógio — e a VPS já tem um (crontab), como o do Google Agenda (`agenda-google-cron-vps.sh`).
#
# Uso:  cron-vps.sh <job>            (o job tem de estar na lista abaixo)
#
# A LISTA é o portão: só entra aqui job já classificado em docs/runbooks/cron-vps.md. Job que
# pode enviar mensagem ao cliente NÃO entra até a liberação explícita do dono da operação.
# O segredo vem de arquivo 0600 (nunca argumento nem log); a saída registra só job, status HTTP
# e duração — nunca corpo de resposta.
set -euo pipefail

JOB="${1:-}"
case "$JOB" in
  # manutenção/operação — não enviam mensagem ao cliente
  event-log-drain|routing-worker|recover-stuck-messages|channel-health|snooze-watcher|\
  webhook-log-retention|storage-redaction|handoff-devolucao) ;;
  *)
    echo "Job não autorizado: $JOB" >&2
    exit 2
    ;;
esac

SECRET_FILE="${DESKCOMM_CRON_SECRET_FILE:-/root/.deskcomm-cron-secret}"
BASE_URL="${DESKCOMM_BASE_URL:-https://periciaia.vercel.app}"
LOG_FILE="${DESKCOMM_CRON_LOG:-/var/log/deskcomm-cron.log}"

if [[ ! -r "$SECRET_FILE" ]]; then
  echo "Segredo de cron indisponível." >&2
  exit 3
fi
SECRET="$(<"$SECRET_FILE")"
if [[ ${#SECRET} -lt 32 ]]; then
  echo "Segredo de cron inválido." >&2
  exit 4
fi

QUERY=""
[[ "$JOB" == "storage-redaction" ]] && QUERY="?limit=50"

INICIO=$(( $(date +%s%N) / 1000000 ))
STATUS=$(curl --silent --show-error --max-time 55 --output /dev/null --write-out '%{http_code}' \
  -H "Authorization: Bearer $SECRET" "$BASE_URL/api/v1/cron/$JOB$QUERY" || echo 000)
FIM=$(( $(date +%s%N) / 1000000 ))
printf '%s job=%s status=%s ms=%s\n' "$(date -u +%FT%TZ)" "$JOB" "$STATUS" "$((FIM - INICIO))" >> "$LOG_FILE" 2>/dev/null || true
[[ "$STATUS" == 2* ]]
