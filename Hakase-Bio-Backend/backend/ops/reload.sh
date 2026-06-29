#!/usr/bin/env bash
# Zero-downtime reload. Chooses PM2 or systemd based on $RELOAD_STRATEGY.
set -euo pipefail

THIS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$THIS/.." && pwd)"

# Load env
if [[ -f "$BACKEND_DIR/.env" ]]; then set -a; . "$BACKEND_DIR/.env"; set +a; fi

STRATEGY="${RELOAD_STRATEGY:-pm2}"

case "$STRATEGY" in
  pm2)
    if ! command -v pm2 >/dev/null 2>&1; then
      echo "→ installing pm2 globally"
      npm install -g pm2
    fi
    # Prefer the single-process orchestrator. Fall back to the legacy two-app
    # setup if the user prefers managing the children separately.
    if pm2 describe hakase-backend >/dev/null 2>&1; then
      echo "→ pm2 reload hakase-backend (orchestrator, zero-downtime)"
      pm2 reload hakase-backend --update-env
    elif pm2 describe hakase-api-server >/dev/null 2>&1; then
      echo "→ pm2 reload api+ai (legacy, zero-downtime)"
      pm2 reload "$BACKEND_DIR/config/ecosystem.config.cjs" --update-env
    else
      echo "→ pm2 start hakase-backend (orchestrator)"
      pm2 start "$BACKEND_DIR/config/ecosystem.config.cjs" --only hakase-backend --env production
      pm2 save
    fi
    ;;
  systemd)
    echo "→ systemctl reload hakase-backend"
    sudo systemctl reload hakase-backend || sudo systemctl restart hakase-backend
    ;;
  docker)
    echo "→ docker compose up -d --build"
    docker compose -f "$BACKEND_DIR/docker/docker-compose.yml" up -d --build
    ;;
  *)
    echo "Unknown RELOAD_STRATEGY=$STRATEGY"; exit 1 ;;
esac
