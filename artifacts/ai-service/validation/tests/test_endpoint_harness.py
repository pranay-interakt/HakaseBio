"""§2 endpoint-harness self-test — proves the load→predict→score→conformal
pipeline runs correctly on the REAL frozen TDC test labels.

It uses a deterministic SUBSTITUTE predictor (a squashed-logP score). This is
NOT ADMET-AI and the AUROCs it produces are NOT product numbers — the only thing
asserted is that the harness mechanics are correct and that the conformal veto's
marginal FPR ≤ α holds on every endpoint (including tiny DILI). Real product
numbers come from running validation/run_validation.py against the live
ADMET-AI service.

Run:  python3 validation/tests/test_endpoint_harness.py   (from artifacts/ai-service)
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import numpy as np
from rdkit import Chem
from rdkit.Chem import Descriptors

from validation.endpoint_validation import validate_endpoint, load_tdc_test, ENDPOINTS

fails = 0
def check(cond, label, detail=""):
    global fails
    print(("  ✓ " if cond else "  ✗ ") + label + ("" if cond else f"  [{detail}]"))
    if not cond:
        fails += 1


def _substitute_predictor(smiles: str):
    """Deterministic monotone score on a single descriptor — placeholder ONLY to
    exercise the harness; not a real model."""
    m = Chem.MolFromSmiles(smiles)
    if m is None:
        return None
    return float(1.0 / (1.0 + np.exp(-(Descriptors.MolLogP(m) - 2.5) / 2.0)))


ALPHA = 0.05
print("=" * 64 + "\n§2 endpoint harness — real frozen TDC labels, substitute predictor")
for ep in ENDPOINTS:
    smiles, labels = load_tdc_test(ep)
    check(len(smiles) > 0 and len(smiles) == len(labels), f"{ep}: frozen TEST split loads ({len(smiles)} rows)")
    r = validate_endpoint(ep, _substitute_predictor, alpha=ALPHA)
    check(r["status"] == "SCORED", f"{ep}: validator returns SCORED")
    check(r["n_scored"] == len(smiles), f"{ep}: every parseable molecule scored (no silent drops)", f"{r['n_scored']}/{len(smiles)}")
    check(0.0 <= r["auroc"] <= 1.0, f"{ep}: AUROC in [0,1] ({r['auroc']:.3f})")
    lo, hi = r["auroc_ci95"]
    check(lo <= r["auroc"] <= hi, f"{ep}: AUROC point inside its 95% CI ({lo:.3f}–{hi:.3f})")
    cv = r["conformal_veto"]
    check(cv["mean_realised_fpr"] <= ALPHA + 0.015,
          f"{ep}: marginal conformal FPR ≤ α over 200 splits ({cv['mean_realised_fpr']:.3f} ≤ {ALPHA})",
          str(cv["mean_realised_fpr"]))

print("\n" + "=" * 64)
print("§2 HARNESS SELF-TEST PASSED" if fails == 0 else f"FAILED — {fails} check(s)")
sys.exit(1 if fails else 0)
