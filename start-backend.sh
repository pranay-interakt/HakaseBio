#!/usr/bin/env bash
# =============================================================================
# Hakase BioTwin — Backend startup script
# Works on: Linux (Ubuntu/Debian), macOS, RunPod pods, DigitalOcean droplets,
#           AWS EC2, Azure VMs, any POSIX shell environment.
#
# What this starts:
#   1. AI Service  — FastAPI/Python on port $AI_SERVICE_PORT (default 8090)
#   2. API Server  — Express/Node on port $PORT (default 3000)
#
# GPU-intensive jobs (Boltz-2, FEP) dispatch to whichever provider is set in
# your .env via GPU_PROVIDER. If GPU_PROVIDER=runpod and you're on a RunPod
# pod, those jobs still dispatch to RunPod Serverless (separate endpoint).
# The rest of the AI service (ADMET, docking, ML models) runs right here.
#
# Usage:
#   cp .env.example .env && nano .env   # fill in your values
#   chmod +x start-backend.sh
#   ./start-backend.sh
#
# To stop:  kill $(cat .pids) or just Ctrl+C (kills both processes)
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# ── Load .env if present ─────────────────────────────────────────────────────
if [ -f ".env" ]; then
  echo "→ Loading .env"
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# ── Defaults ─────────────────────────────────────────────────────────────────
export PORT="${PORT:-3000}"
export AI_SERVICE_PORT="${AI_SERVICE_PORT:-8090}"
export AI_SERVICE_URL="${AI_SERVICE_URL:-http://localhost:${AI_SERVICE_PORT}}"
export NODE_ENV="${NODE_ENV:-production}"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║         Hakase BioTwin — Backend                ║"
echo "╚══════════════════════════════════════════════════╝"
echo "  API Server  → http://0.0.0.0:${PORT}"
echo "  AI Service  → http://0.0.0.0:${AI_SERVICE_PORT}"
echo "  GPU_PROVIDER = ${GPU_PROVIDER:-runpod (default)}"
echo ""

# ── 1. System dependencies ───────────────────────────────────────────────────
install_system_deps() {
  # Only runs if the binaries are missing — safe to call every time.
  local NEED_APT=0

  if ! command -v vina &>/dev/null; then
    echo "→ AutoDock Vina not found — will install"
    NEED_APT=1
  fi
  if ! command -v obabel &>/dev/null; then
    echo "→ OpenBabel not found — will install"
    NEED_APT=1
  fi

  if [ "$NEED_APT" -eq 1 ]; then
    if command -v apt-get &>/dev/null; then
      echo "→ Installing system packages (Ubuntu/Debian)..."
      sudo apt-get update -qq
      sudo apt-get install -y -qq autodock-vina openbabel
    elif command -v brew &>/dev/null; then
      echo "→ Installing system packages (macOS Homebrew)..."
      brew install autodock-vina open-babel 2>/dev/null || true
    else
      echo "⚠ Cannot auto-install vina/obabel — install them manually."
      echo "  Ubuntu:  sudo apt-get install autodock-vina openbabel"
      echo "  macOS:   brew install autodock-vina open-babel"
      echo "  Docking jobs will fail until these are installed."
    fi
  fi
}

install_system_deps

# ── 2. Python environment ────────────────────────────────────────────────────
echo "→ Setting up Python environment..."
AI_DIR="$REPO_ROOT/artifacts/ai-service"

# Prefer the repo's own .venv if it exists, else create one
if [ ! -d "$REPO_ROOT/.venv" ]; then
  echo "  Creating .venv..."
  python3 -m venv "$REPO_ROOT/.venv"
fi

# shellcheck disable=SC1091
source "$REPO_ROOT/.venv/bin/activate"

# Install/update Python deps (quiet, only if needed)
pip install -q --upgrade pip
pip install -q -r "$AI_DIR/requirements.txt"

# GPU_PROVIDER=aws needs boto3
if [ "${GPU_PROVIDER:-runpod}" = "aws" ]; then
  pip install -q boto3
fi

echo "  Python deps ready."

# ── 3. Node / pnpm ───────────────────────────────────────────────────────────
echo "→ Setting up Node dependencies..."

if ! command -v pnpm &>/dev/null; then
  echo "  pnpm not found — installing via npm..."
  npm install -g pnpm --silent
fi

pnpm install --frozen-lockfile --silent 2>/dev/null || pnpm install --silent
echo "  Node deps ready."

# ── 4. Build the API server ──────────────────────────────────────────────────
echo "→ Building API server..."
cd "$REPO_ROOT/artifacts/api-server"
pnpm run build 2>/dev/null || echo "  (build step skipped — running in dev mode)"
cd "$REPO_ROOT"

# ── 5. Launch processes ──────────────────────────────────────────────────────
PID_FILE="$REPO_ROOT/.pids"
LOG_DIR="$REPO_ROOT/.logs"
mkdir -p "$LOG_DIR"
> "$PID_FILE"   # reset pid file

cleanup() {
  echo ""
  echo "→ Shutting down..."
  if [ -f "$PID_FILE" ]; then
    while read -r pid; do
      kill "$pid" 2>/dev/null || true
    done < "$PID_FILE"
  fi
  rm -f "$PID_FILE"
  echo "  Done."
}
trap cleanup EXIT INT TERM

# Start AI Service (Python / FastAPI)
echo ""
echo "→ Starting AI Service (port ${AI_SERVICE_PORT})..."
cd "$AI_DIR"
AI_SERVICE_PORT="$AI_SERVICE_PORT" python main.py \
  > "$LOG_DIR/ai-service.log" 2>&1 &
AI_PID=$!
echo "$AI_PID" >> "$PID_FILE"
echo "  AI Service PID: $AI_PID  (logs: .logs/ai-service.log)"
cd "$REPO_ROOT"

# Wait for AI service to be ready (up to 30s)
echo "  Waiting for AI service..."
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${AI_SERVICE_PORT}/health" &>/dev/null; then
    echo "  AI service ready ✓"
    break
  fi
  sleep 1
done

# Start API Server (Node / Express)
echo ""
echo "→ Starting API Server (port ${PORT})..."
cd "$REPO_ROOT/artifacts/api-server"

# Use built output if it exists, fall back to tsx dev mode
if [ -f "dist/index.js" ]; then
  PORT="$PORT" node dist/index.js \
    > "$LOG_DIR/api-server.log" 2>&1 &
else
  PORT="$PORT" pnpm run dev \
    > "$LOG_DIR/api-server.log" 2>&1 &
fi

API_PID=$!
echo "$API_PID" >> "$PID_FILE"
echo "  API Server PID: $API_PID  (logs: .logs/api-server.log)"
cd "$REPO_ROOT"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Backend is running.  Ctrl+C to stop.           ║"
echo "║                                                  ║"
echo "║  API Server  →  http://localhost:${PORT}          ║"
echo "║  AI Service  →  http://localhost:${AI_SERVICE_PORT}         ║"
echo "║  Health      →  http://localhost:${PORT}/api/health║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "  Tailing logs (Ctrl+C to stop all):"
echo ""

# Tail both logs together so you see output inline
tail -f "$LOG_DIR/ai-service.log" "$LOG_DIR/api-server.log"
