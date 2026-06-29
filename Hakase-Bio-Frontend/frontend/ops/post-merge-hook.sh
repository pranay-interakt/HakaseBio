#!/usr/bin/env bash
# Git post-merge hook for auto-rebuild + reload on `git pull`.
#   ln -sf ../../frontend/ops/post-merge-hook.sh .git/hooks/post-merge
#   chmod +x .git/hooks/post-merge
set -euo pipefail
THIS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FE_DIR="$(cd "$THIS/.." && pwd)"

if [[ -f "$FE_DIR/.env" ]]; then set -a; . "$FE_DIR/.env"; set +a; fi
if [[ "${AUTO_RELOAD_ON_PULL:-true}" != "true" ]]; then
  echo "→ AUTO_RELOAD_ON_PULL=false; skipping"
  exit 0
fi

node "$FE_DIR/scripts/install.mjs"
node "$FE_DIR/scripts/build.mjs"
bash "$FE_DIR/ops/reload.sh"
echo "✓ frontend post-merge reload complete"
