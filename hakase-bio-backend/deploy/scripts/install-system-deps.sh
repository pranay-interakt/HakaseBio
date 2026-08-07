#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# System (OS-level) prerequisites for the Hakase Bio backend AI service.
# Target: Debian/Ubuntu Linux server (the recommended hosting OS).
#
# These are the native libraries/binaries the Python ML stack needs but pip/uv
# CANNOT install for you:
#   • build-essential       — compiling native wheels
#   • openbabel             — cheminformatics file/format conversion
#   • libxrender1, libxext6 — RDKit drawing/runtime libs
#   • hmmer                 — required by ANARCI (antibody IMGT numbering)
#   • r-base                — Rscript, for the L3 Animal Cohort mrgsolve PBPK
#                             cohort engine (modalities/.../l3/mrgsolve_adapter.py).
#                             The mrgsolve + jsonlite R packages are installed
#                             into ~/Rlibs (the path the adapter reads). If R is
#                             absent the L3 layer transparently falls back to the
#                             in-house kernel PBPK engine — it never breaks.
#   • python3-venv, curl, git
#
# Usage:   sudo bash deploy/scripts/install-system-deps.sh
#
# macOS dev equivalent (Homebrew):
#   brew install open-babel hmmer r
#   Rscript -e 'install.packages(c("mrgsolve","jsonlite"), repos="https://cloud.r-project.org", lib=path.expand("~/Rlibs"))'
#   # RDKit/torch wheels install cleanly via uv/pip on macOS.
#
# Windows: install via WSL (Ubuntu) and run this script inside WSL. Native
# Windows is fine for the Node API + frontend, but the ML service is far
# smoother under WSL/Linux.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script targets Debian/Ubuntu (apt-get not found)."
  echo "On macOS:  brew install open-babel hmmer"
  echo "On Windows: use WSL (Ubuntu) and re-run this script there."
  exit 1
fi

SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

echo "→ Updating apt and installing system dependencies…"
$SUDO apt-get update -y
$SUDO apt-get install -y --no-install-recommends \
  build-essential \
  curl \
  ca-certificates \
  git \
  python3 \
  python3-venv \
  python3-dev \
  openbabel \
  libxrender1 \
  libxext6 \
  hmmer \
  r-base

# ── R packages for the L3 Animal Cohort mrgsolve PBPK engine ─────────────────
# Installed into ~/Rlibs so the mrgsolve_adapter finds them with a minimal PATH.
# Best-effort: mrgsolve compiles C++ models at runtime and needs a toolchain
# (build-essential, above). If this fails the L3 layer falls back to the kernel
# engine, so we do not abort the whole install on an R package hiccup.
if command -v Rscript >/dev/null 2>&1; then
  echo "→ Installing R packages (mrgsolve, jsonlite) into ~/Rlibs…"
  RLIBS="${R_LIBS_USER:-$HOME/Rlibs}"
  mkdir -p "$RLIBS"
  Rscript -e "install.packages(c('mrgsolve','jsonlite'), repos='https://cloud.r-project.org', lib=Sys.getenv('R_LIBS_USER', path.expand('~/Rlibs')))" \
    || echo "⚠ R package install failed — L3 will fall back to the in-house kernel PBPK engine."
else
  echo "⚠ Rscript not found after apt install — skipping mrgsolve (L3 falls back to kernel engine)."
fi

echo
echo "✓ System dependencies installed."
echo
echo "Next, ensure these toolchains are present (one-time, per machine):"
echo "  • Node 20+      — https://nodejs.org  (or nvm)"
echo "  • pnpm          — npm install -g pnpm"
echo "  • uv (Python)   — curl -LsSf https://astral.sh/uv/install.sh | sh"
echo
echo "Then from the repo root:  pnpm run setup  &&  pnpm run backend"
