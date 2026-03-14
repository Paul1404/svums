#!/bin/sh
set -eu

PORT="${PORT:-8000}"

exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "$PORT" \
  --proxy-headers \
  --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1,::1}"
