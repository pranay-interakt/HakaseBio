#!/usr/bin/env bash
# Zero-downtime frontend reload: PM2 / systemd / nginx-static.
set -euo pipefail
THIS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FE_DIR="$(cd "$THIS/.." && pwd)"

if [[ -f "$FE_DIR/.env" ]]; then set -a; . "$FE_DIR/.env"; set +a; fi
STRATEGY="${RELOAD_STRATEGY:-pm2}"

case "$STRATEGY" in
  pm2)
    if ! command -v pm2 >/dev/null 2>&1; then npm install -g pm2; fi
    if pm2 describe hakase-frontend >/dev/null 2>&1; then
      pm2 reload "$FE_DIR/config/ecosystem.config.cjs" --update-env
    else
      pm2 start "$FE_DIR/config/ecosystem.config.cjs" --env production
      pm2 save
    fi
    ;;
  systemd)
    sudo systemctl reload hakase-frontend || sudo systemctl restart hakase-frontend
    ;;
  nginx-static)
    # The build already overwrote artifacts/hakase-ai/dist atomically.
    # Just tell nginx to reload its config (picks up new index.html mtimes immediately).
    sudo nginx -t && sudo systemctl reload nginx
    ;;
  docker)
    docker compose -f "$FE_DIR/docker/docker-compose.yml" up -d --build
    ;;
  *) echo "Unknown RELOAD_STRATEGY=$STRATEGY"; exit 1 ;;
esac
