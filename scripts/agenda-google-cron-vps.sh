#!/usr/bin/env bash
set -euo pipefail

JOB="${1:-}"
case "$JOB" in
  agenda-google-push|agenda-google-refresh|agenda-google-sync) ;;
  *)
    echo "Job inválido: $JOB" >&2
    exit 2
    ;;
esac

SECRET_FILE="${DESKCOMM_CRON_SECRET_FILE:-/root/.deskcomm-cron-secret}"
BASE_URL="${DESKCOMM_BASE_URL:-https://periciaia.vercel.app}"

if [[ ! -r "$SECRET_FILE" ]]; then
  echo "Segredo de cron indisponível." >&2
  exit 3
fi

SECRET="$(<"$SECRET_FILE")"
if [[ ${#SECRET} -lt 32 ]]; then
  echo "Segredo de cron inválido." >&2
  exit 4
fi

URL="$BASE_URL/api/v1/cron/$JOB"
if [[ "${DESKCOMM_CRON_VERBOSE:-0}" == "1" ]]; then
  curl --fail --silent --show-error --max-time 55 \
    -H "Authorization: Bearer $SECRET" "$URL"
else
  curl --fail --silent --show-error --max-time 55 \
    -H "Authorization: Bearer $SECRET" "$URL" >/dev/null
fi
