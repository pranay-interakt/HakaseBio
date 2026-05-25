#!/usr/bin/env bash
# =============================================================================
# Hakase BioTwin — Frontend startup script
# Works on: Linux, macOS, Vercel build step, Netlify, any static host.
#
# Modes:
#   ./start-frontend.sh           → production build + serve (default)
#   ./start-frontend.sh dev       → Vite dev server (hot reload)
#   ./start-frontend.sh build     → build only, no serve (for Vercel/Netlify)
#
# Env vars that matter here:
#   PORT          — port to serve on (default 4000)
#   BASE_PATH     — URL base path (default /)
#   VITE_API_URL  — override if API server is on a different host
#                   (leave unset when frontend and API are on same domain)
#
# Usage:
#   cp .env.example .env && nano .env
#   chmod +x start-frontend.sh
#   ./start-frontend.sh
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$REPO_ROOT/artifacts/hakase-ai"
MODE="${1:-serve}"   # serve | dev | build

# ── Load .env if present ─────────────────────────────────────────────────────
if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

export PORT="${PORT:-4000}"
export BASE_PATH="${BASE_PATH:-/}"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║         Hakase BioTwin — Frontend               ║"
echo "╚══════════════════════════════════════════════════╝"
echo "  Mode      : $MODE"
echo "  Port      : $PORT"
echo "  Base path : $BASE_PATH"
echo ""

# ── Node / pnpm ──────────────────────────────────────────────────────────────
if ! command -v pnpm &>/dev/null; then
  echo "→ pnpm not found — installing via npm..."
  npm install -g pnpm --silent
fi

echo "→ Installing Node dependencies..."
cd "$REPO_ROOT"
pnpm install --frozen-lockfile --silent 2>/dev/null || pnpm install --silent
echo "  Done."

cd "$FRONTEND_DIR"

# ── Modes ────────────────────────────────────────────────────────────────────

if [ "$MODE" = "dev" ]; then
  echo ""
  echo "→ Starting Vite dev server (hot reload)..."
  echo "  Frontend → http://localhost:${PORT}"
  echo "  API proxy → http://localhost:3000  (set PORT=3000 for API server)"
  echo ""
  PORT="$PORT" BASE_PATH="$BASE_PATH" pnpm run dev

elif [ "$MODE" = "build" ]; then
  echo ""
  echo "→ Building for production..."
  BASE_PATH="$BASE_PATH" pnpm run build
  echo ""
  echo "  Build complete → artifacts/hakase-ai/dist/public/"
  echo "  Point your web server (nginx, Caddy, Vercel, Netlify) at that folder."

else
  # Default: build then serve
  echo "→ Building for production..."
  BASE_PATH="$BASE_PATH" pnpm run build
  echo "  Build complete."
  echo ""

  # Serve the static output — prefer 'serve', fall back to 'npx serve'
  DIST_DIR="$FRONTEND_DIR/dist/public"

  if command -v serve &>/dev/null; then
    echo "→ Serving on port ${PORT}..."
    serve -s "$DIST_DIR" -l "$PORT"
  elif command -v python3 &>/dev/null; then
    echo "→ Serving via Python http.server on port ${PORT}..."
    echo "  (install 'serve' for a better static server: npm i -g serve)"
    cd "$DIST_DIR"
    python3 -m http.server "$PORT"
  else
    echo ""
    echo "  Build is at: $DIST_DIR"
    echo "  To serve it, run one of:"
    echo "    npx serve -s $DIST_DIR -l $PORT"
    echo "    npm i -g serve && serve -s $DIST_DIR -l $PORT"
    echo "    Or point nginx/Caddy at that directory."
  fi
fi
