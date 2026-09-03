#!/bin/sh
# Render Docker Command: sh infra/start-backend.sh
# (Render rejects $, {}, ", and @ in dockerCommand)
export BACKEND_PORT="${PORT:-${BACKEND_PORT:-4001}}"
exec pnpm --dir apps/backend start
