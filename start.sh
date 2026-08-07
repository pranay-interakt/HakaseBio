#!/usr/bin/env bash
set -e

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$REPO_ROOT/hakase-bio-backend"
FRONTEND_DIR="$REPO_ROOT/hakase-invitro-workspace"

export REPO_ROOT
export PORT="${PORT:-3000}"
export AI_SERVICE_PORT="${AI_SERVICE_PORT:-8090}"
export AI_SERVICE_URL="${AI_SERVICE_URL:-http://localhost:$AI_SERVICE_PORT}"
export NODE_ENV="${NODE_ENV:-development}"
export PYTHONUNBUFFERED=1

# ── Load .env if present ─────────────────────────────────────────────────────
if [ -f "$BACKEND_DIR/.env" ]; then
  set -a; source "$BACKEND_DIR/.env"; set +a
elif [ -f "$REPO_ROOT/.env" ]; then
  set -a; source "$REPO_ROOT/.env"; set +a
fi

# ── Install dependencies if missing ─────────────────────────────────────────
install_backend_deps() {
  echo "==> Installing backend Node.js dependencies..."
  cd "$BACKEND_DIR"
  if command -v pnpm &>/dev/null; then
    pnpm install --no-frozen-lockfile 2>/dev/null || npm install
  else
    npm install -g pnpm && pnpm install --no-frozen-lockfile 2>/dev/null || npm install
  fi

  echo "==> Setting up Python virtual environment..."
  if [ ! -d "$BACKEND_DIR/.venv" ]; then
    python3 -m venv "$BACKEND_DIR/.venv"
  fi
  source "$BACKEND_DIR/.venv/bin/activate"

  if command -v uv &>/dev/null; then
    echo "==> Installing Python dependencies with uv..."
    uv sync --no-strict 2>/dev/null || uv pip install -e . 2>/dev/null || pip install -e .
  else
    echo "==> Installing Python dependencies with pip..."
    pip install --upgrade pip
    pip install -e . 2>/dev/null || echo "⚠ Some Python deps may need manual install (torch, rdkit)"
  fi
  cd "$REPO_ROOT"
}

install_frontend_deps() {
  echo "==> Installing frontend dependencies..."
  cd "$FRONTEND_DIR"
  if command -v pnpm &>/dev/null; then
    pnpm install --no-frozen-lockfile 2>/dev/null || npm install
  else
    npm install
  fi
  cd "$REPO_ROOT"
}

# Only install if node_modules is missing
if [ ! -d "$BACKEND_DIR/node_modules" ]; then
  install_backend_deps
fi

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  install_frontend_deps
fi

# Activate venv if it exists
if [ -f "$BACKEND_DIR/.venv/bin/activate" ]; then
  source "$BACKEND_DIR/.venv/bin/activate"
fi

# ── Trap for clean shutdown ──────────────────────────────────────────────────
cleanup() {
  echo "Shutting down..."
  kill $AI_PID $API_PID $FE_PID 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT INT TERM

# ── Start AI service (FastAPI on :8090) ──────────────────────────────────────
echo "==> Starting AI service on port $AI_SERVICE_PORT..."
cd "$BACKEND_DIR/service"
python3 -m hakase_service.main &
AI_PID=$!
cd "$REPO_ROOT"

# ── Start API gateway (Express on :3000) ─────────────────────────────────────
echo "==> Starting API gateway on port $PORT..."
cd "$BACKEND_DIR"
if command -v pnpm &>/dev/null; then
  pnpm --filter @platform/gateway run dev &
else
  npx tsx platform/gateway/src/index.ts &
fi
API_PID=$!
cd "$REPO_ROOT"

# ── Start frontend (Vite on :4176) ──────────────────────────────────────────
echo "==> Starting frontend on port 4176..."
cd "$FRONTEND_DIR"
if command -v pnpm &>/dev/null; then
  pnpm run dev &
else
  npx vite --host 0.0.0.0 &
fi
FE_PID=$!
cd "$REPO_ROOT"

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Hakase BioTwin is starting up"
echo "  Frontend:    http://localhost:4176"
echo "  API Gateway: http://localhost:$PORT"
echo "  AI Service:  http://localhost:$AI_SERVICE_PORT"
echo "════════════════════════════════════════════════════════"
echo ""

# Wait for any process to exit
wait -n $AI_PID $API_PID $FE_PID 2>/dev/null || true
