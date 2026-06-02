#!/usr/bin/env bash
# Git hook target — drop in .git/hooks/post-merge (or symlink) so that
# every `git pull` on the deploy host triggers a zero-downtime reload.
#
#   ln -sf ../../backend/ops/post-merge-hook.sh .git/hooks/post-merge
#   chmod +x .git/hooks/post-merge
#
# CI/CD pipelines can call this directly after `git pull` instead of restarting
# the service manually.
set -euo pipefail

THIS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$THIS/.." && pwd)"

if [[ -f "$BACKEND_DIR/.env" ]]; then set -a; . "$BACKEND_DIR/.env"; set +a; fi

if [[ "${AUTO_RELOAD_ON_PULL:-true}" != "true" ]]; then
  echo "→ AUTO_RELOAD_ON_PULL=false; skipping reload"
  exit 0
fi

node "$BACKEND_DIR/scripts/install.mjs"
node "$BACKEND_DIR/scripts/build.mjs" || true
bash "$BACKEND_DIR/ops/reload.sh"
node "$BACKEND_DIR/scripts/healthcheck.mjs"
echo "✓ post-merge reload complete"
