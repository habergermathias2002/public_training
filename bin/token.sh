#!/usr/bin/env bash
# Holt ein Access-Token (JWT, gilt 24 h) fuer die Garmin Personal API und legt es in .token ab.
# Der API-Key kommt aus api_key.txt (nur die Key-Zeile) oder, falls die leer ist, aus dem
# macOS-Schluesselbund (Dienst: garmin-personal-api). Er wird nie ausgegeben.
set -euo pipefail
cd "$(dirname "$0")/.."

KEY="${GARMIN_API_KEY:-}"
if [[ -z "$KEY" && -s .env ]]; then
  KEY=$(grep -E '^GARMIN_API_KEY=' .env | cut -d '=' -f2- | tr -d '[:space:]"'\''' || true)
fi
if [[ -z "$KEY" && -s api_key.txt ]]; then
  KEY=$(tr -d '[:space:]' < api_key.txt)
fi
if [[ -z "$KEY" ]] && command -v security >/dev/null 2>&1; then
  KEY=$(security find-generic-password -s garmin-personal-api -w 2>/dev/null) || KEY=""
fi
if [[ -z "$KEY" ]]; then
  echo "Kein Key gefunden. GARMIN_API_KEY setzen oder in api_key.txt einfuegen." >&2
  exit 1
fi

umask 077
# Header ueber stdin, damit der Key nicht in der Prozessliste steht.
printf 'Authorization: ApiKey %s\n' "$KEY" | curl -sS --fail-with-body -X POST \
  'https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token' \
  -H @- -o .token
unset KEY

echo "Token gespeichert in .token"
