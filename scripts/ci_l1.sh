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

echo "── [1/3] frontend typecheck ──────────────────────────────"
( cd "$ROOT/artifacts/hakase-ai" && pnpm run typecheck )

echo "── [2/3] L1 verdict regression suite ─────────────────────"
( cd "$ROOT/artifacts/hakase-ai" && pnpm exec tsx scripts/l1_verdict_suite.ts )

echo "── [3/4] validation framework tests (metrics + conformal) ─"
( cd "$ROOT/artifacts/ai-service" && python3 validation/tests/run_tests.py )

echo "── [4/4] §2 endpoint-harness self-test on frozen TDC labels ─"
( cd "$ROOT/artifacts/ai-service" && python3 validation/tests/test_endpoint_harness.py )

echo ""
echo "✅ All L1 CI checks passed."
