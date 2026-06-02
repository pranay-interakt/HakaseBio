#!/usr/bin/env bash
# Frontend deploy: git pull → install → build → reload.
set -euo pipefail

THIS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FE_DIR="$(cd "$THIS/.." && pwd)"
REPO_ROOT="$(cd "$FE_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "→ git fetch + fast-forward"
git fetch --all --prune
git pull --ff-only

echo "→ preflight"
node "$FE_DIR/scripts/preflight.mjs"

echo "→ install"
node "$FE_DIR/scripts/install.mjs"

echo "→ build"
node "$FE_DIR/scripts/build.mjs"

echo "→ reload"
bash "$FE_DIR/ops/reload.sh"

echo "✓ Frontend deploy complete"
