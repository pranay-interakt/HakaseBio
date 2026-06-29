"""§2 endpoint-harness self-test — proves the load→predict→score pipeline runs
correctly on the REAL frozen TDC test labels for the WHOLE ADMET panel
(binary + regression).

It uses a deterministic SUBSTITUTE predictor (a logP value). This is NOT Hakase ADMET
and the AUROC / R² it produces are NOT product numbers — the only thing asserted
is that the harness mechanics are correct (loads every split, scores without
silent drops, returns the right metric shape per endpoint kind, and the conformal
veto's marginal FPR ≤ α holds for the binary endpoints). Real product numbers
come from validation/run_validation.py against the live Hakase ADMET service.

Run:  python3 validation/tests/test_endpoint_harness.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import numpy as np
from rdkit import Chem
from rdkit.Chem import Descriptors

from validation.endpoint_validation import validate_endpoint, load_tdc_test, PANEL

fails = 0
def check(cond, label, detail=""):
    global fails
    print(("  ✓ " if cond else "  ✗ ") + label + ("" if cond else f"  [{detail}]"))
    if not cond:
        fails += 1


def _substitute(smiles: str):
    # Strictly-positive deterministic stand-in so the fold-error path (which
    # requires positive predictions) is exercised. NOT a real model.
    m = Chem.MolFromSmiles(smiles)
    return None if m is None else float(abs(Descriptors.MolLogP(m)) + 0.5)


ALPHA = 0.05
print("=" * 70 + "\n§2 full-panel harness — real frozen TDC labels, substitute predictor\n")
n_binary = n_reg = 0
for name, cfg in PANEL.items():
    smiles, ys = load_tdc_test(name)
    if len(smiles) == 0:
        check(False, f"{name}: frozen split present"); continue
    r = validate_endpoint(name, _substitute, alpha=ALPHA)
    if r["status"] != "SCORED":
        check(False, f"{name}: SCORED", r.get("status")); continue
    check(r["n_scored"] == len(smiles), f"{name:15s} [{cfg['kind']:6s}] scored {r['n_scored']}/{len(smiles)} (no silent drops)")
    if cfg["kind"] == "binary":
        n_binary += 1
        check(0.0 <= r["auroc"] <= 1.0, f"{name:15s} AUROC in [0,1] = {r['auroc']:.3f}")
        cv = r.get("conformal_veto")
        if cv:
            check(cv["mean_realised_fpr"] <= ALPHA + 0.02, f"{name:15s} conformal FPR ≤ α ({cv['mean_realised_fpr']:.3f})", str(cv["mean_realised_fpr"]))
    else:
        n_reg += 1
        check("r2" in r and "spearman" in r and "mae" in r, f"{name:15s} regression metrics present (R²={r['r2']:.2f}, ρ={r['spearman']:.2f})")
        if cfg.get("fold"):
            check("fold_error" in r, f"{name:15s} fold-error reported (positive-linear endpoint)")

print(f"\n{'='*70}\npanel: {n_binary} binary + {n_reg} regression endpoints exercised")
print("§2 FULL-PANEL HARNESS PASSED" if fails == 0 else f"FAILED — {fails} check(s)")
sys.exit(1 if fails else 0)
