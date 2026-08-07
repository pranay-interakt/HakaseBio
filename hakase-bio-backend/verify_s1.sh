#!/bin/bash
source .venv/bin/activate
branches=(
  "feat/pbpk-disposition-contract"
  "feat/pbpk-physiology-store"
  "feat/pbpk-species-extrapolation"
  "feat/pbpk-pka-predictor"
  "feat/pbpk-rr-kp"
  "feat/pbpk-uncertainty-helpers"
  "feat/pbpk-ivive-uncertainty"
  "feat/pbpk-disposition-assembler"
)

for branch in "${branches[@]}"; do
  echo "======================================"
  echo "Verifying branch: $branch"
  git checkout $branch -q
  echo "--- check_boundaries ---"
  python scripts/check_boundaries.py
  echo "--- ruff ---"
  ruff check .
  echo "--- black ---"
  black --check .
  echo "--- pytest ---"
  pytest platform/ modalities/
  echo "======================================"
done
git checkout staging -q
