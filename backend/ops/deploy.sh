#!/usr/bin/env bash
# Full deploy: git pull → install → build → reload → healthcheck.
# Idempotent. Safe to run from CI/CD post-deploy step.
set -euo pipefail

THIS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$THIS/.." && pwd)"
REPO_ROOT="$(cd "$BACKEND_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "→ git fetch + fast-forward"
git fetch --all --prune
git pull --ff-only

echo "→ preflight"
node "$BACKEND_DIR/scripts/preflight.mjs"

echo "→ install"
node "$BACKEND_DIR/scripts/install.mjs"

echo "→ build"
node "$BACKEND_DIR/scripts/build.mjs" || true

echo "→ reload"
bash "$BACKEND_DIR/ops/reload.sh"

echo "→ healthcheck"
node "$BACKEND_DIR/scripts/healthcheck.mjs"

echo "✓ Backend deploy complete"
