#!/bin/sh
# CLI de n8n desde la imagen oficial, para correr el e2e sin instalar n8n:
#   N8N_BIN=./test/e2e/n8n-docker.sh npm run test:e2e
# Usa la red del host (Linux) para llegar a Postgres, Redis y los mocks en 127.0.0.1.
exec docker run --rm --network host -u "$(id -u):$(id -g)" \
  -v "$N8N_USER_FOLDER:$N8N_USER_FOLDER" \
  -e N8N_USER_FOLDER -e N8N_PORT -e N8N_LISTEN_ADDRESS -e N8N_ENCRYPTION_KEY \
  -e N8N_DIAGNOSTICS_ENABLED -e N8N_SECURE_COOKIE -e N8N_BLOCK_ENV_ACCESS_IN_NODE -e CHATWOOT_URL \
  "n8nio/n8n:${N8N_VERSION:-2.46.4}" "$@"
