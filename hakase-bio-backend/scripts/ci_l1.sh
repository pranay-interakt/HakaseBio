#!/usr/bin/env bash
# L1 CI gate — runs every L1 correctness suite and fails the build on any error.
# Wire into CI (GitHub Actions / Replit) as a required check.
#
#   bash scripts/ci_l1.sh
#
# Covers:
#   1. TypeScript typecheck (frontend) — no type regressions in the verdict logic.
#   2. L1 verdict regression suite — 12 archetype cases incl. corroboration-gated
#      reactive-metabolite veto and IVIVE PK WATCH-only behaviour.
#   3. Validation-framework tests — metrics proven == scikit-learn, conformal
#      coverage / FPR guarantees verified on real data.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Steps 1–2 live in the FRONTEND repo (apps/hakase-ai). In the split layout the
# backend repo doesn't contain them, so they are skipped automatically here and
# should be run from the Hakase-Bio-Frontend repo instead.
if [ -d "$ROOT/apps/hakase-ai" ]; then
  echo "── [1/4] frontend typecheck ──────────────────────────────"
  ( cd "$ROOT/apps/hakase-ai" && pnpm run typecheck )

  echo "── [2/4] L1 verdict regression suite ─────────────────────"
  ( cd "$ROOT/apps/hakase-ai" && pnpm exec tsx scripts/l1_verdict_suite.ts )
else
  echo "── [1-2/4] frontend steps SKIPPED (apps/hakase-ai not in this repo) ──"
fi

# Both suites moved to modalities/small-molecule/validation in the modality
# restructure, and import workspace packages (hakase_kernel), so they need the
# uv venv's python rather than the system one.
PY="$ROOT/.venv/bin/python"
[ -x "$PY" ] || PY=python3
SMALLMOL="$ROOT/modalities/small-molecule"

echo "── [3/4] validation framework tests (metrics + conformal) ─"
( cd "$SMALLMOL" && "$PY" validation/tests/run_tests.py )

echo "── [4/4] §2 endpoint-harness self-test on frozen TDC labels ─"
( cd "$SMALLMOL" && "$PY" validation/tests/test_endpoint_harness.py )

echo ""
echo "✅ All L1 CI checks passed."
