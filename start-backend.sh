#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

if ! command -v pnpm &>/dev/null; then
  echo "→ pnpm not found — installing via npm..."
  npm install -g pnpm --silent
fi

pnpm install --silent
pnpm backend
