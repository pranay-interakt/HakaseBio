"""§2 — ML safety-endpoint validation against the TDC benchmark TEST splits.

For each endpoint (hERG, AMES, DILI) this:
  1. Loads the FROZEN TDC scaffold-split TEST set (validation/datasets/*.csv) —
     the standard, published hold-out ADMET-AI reports on. No PyTDC/Dataverse
     dependency at run time; the CSVs are committed for reproducibility.
  2. Gets the model probability for every test molecule from the LIVE ai-service
     ADMET-AI endpoint (predictor.predict_prob). Molecules the model can't score
     are SKIPPED, never imputed.
  3. Computes AUROC (+ 95% bootstrap CI), AUPRC, Brier, ECE calibration, and —
     leakage-free — fits the conformal FPR-controlled veto threshold on half the
     negative (safe) class and reports the realised FPR on the other half.

The output is the per-endpoint receipt a buyer asks for, and the conformal
thresholds are the measured, guaranteed replacements for the hand-set cutoffs in
l1Thresholds.json. Every number comes from real predictions vs real labels.
"""
from __future__ import annotations

import csv
import os
from typing import Callable, Optional

import numpy as np

from validation import metrics as M
from models.conformal import ConformalVetoGate, empirical_fpr

_HERE = os.path.dirname(os.path.abspath(__file__))
DATASET_DIR = os.path.join(_HERE, "datasets")

# TDC endpoint name → (frozen csv stem, ADMET-AI output column key).
ENDPOINTS = {
    "hERG": ("tdc_herg_test", "hERG"),
    "AMES": ("tdc_ames_test", "AMES"),
    "DILI": ("tdc_dili_test", "DILI"),
}


def load_tdc_test(endpoint: str) -> tuple[list[str], list[int]]:
    """Return (smiles, labels) for the frozen TDC TEST split. Falls back to live
    PyTDC only if the frozen CSV is absent; raises (never fabricates) otherwise."""
    if endpoint not in ENDPOINTS:
        raise ValueError(f"unknown endpoint {endpoint!r}; known: {list(ENDPOINTS)}")
    stem, _ = ENDPOINTS[endpoint]
    path = os.path.join(DATASET_DIR, f"{stem}.csv")
    if os.path.exists(path):
        smiles, labels = [], []
        with open(path, newline="") as f:
            for row in csv.DictReader(f):
                smiles.append(row["Drug"])
                labels.append(int(float(row["Y"])))
        return smiles, labels
    try:  # last-resort live fetch (user env with PyTDC)
        from tdc.single_pred import Tox  # type: ignore
        te = Tox(name=endpoint).get_split()["test"]
        return te["Drug"].tolist(), [int(v) for v in te["Y"].tolist()]
    except Exception as e:  # noqa: BLE001
        raise FileNotFoundError(
            f"No frozen split at {path} and PyTDC unavailable ({e}). "
            f"Commit the CSV or `pip install PyTDC`."
        )


def validate_endpoint(
    endpoint: str,
    predict_prob: Callable[[str], Optional[float]],
    alpha: float = 0.05,
    max_n: Optional[int] = None,
    seed: int = 0,
) -> dict:
    """Score one endpoint end-to-end. `predict_prob(smiles) -> float|None`."""
    smiles, labels = load_tdc_test(endpoint)
    if max_n:
        smiles, labels = smiles[:max_n], labels[:max_n]
    probs: list[float] = []
    ys: list[int] = []
    n_unscored = 0
    for smi, y in zip(smiles, labels):
        p = predict_prob(smi)
        if p is None or not np.isfinite(p):
            n_unscored += 1
            continue
        probs.append(float(p))
        ys.append(int(y))

    n = len(ys)
    if n < 20 or len(set(ys)) < 2:
        return {"endpoint": endpoint, "status": "INSUFFICIENT",
                "n_scored": n, "n_unscored": n_unscored,
                "reason": "fewer than 20 scored molecules or only one class present"}

    ys_arr = np.asarray(ys); pr_arr = np.asarray(probs)
    cls = M.classification_metrics(ys_arr, pr_arr, threshold=0.5)
    ece = M.expected_calibration_error(ys_arr, pr_arr)["ece"]
    auroc_ci = M.bootstrap_ci(ys_arr, pr_arr, lambda t, p: M.auroc(t, p), seed=seed)

    # Conformal veto threshold on the NEGATIVE (label 0 = safe / should-not-be-
    # vetoed) class. Two honest outputs:
    #   • threshold_all_negatives — the single number to DEPLOY (fit on every
    #     negative; for production prefer the larger §1 approved set).
    #   • mean_realised_fpr — the marginal FPR-control guarantee VERIFIED by
    #     repeating leakage-free cal/eval splits (the guarantee is marginal, so a
    #     single split on small n is noisy; we average to report it honestly).
    neg = pr_arr[ys_arr == 0]
    veto = {"status": "n/a (too few negatives)"}
    if neg.size >= 20:
        rng = np.random.RandomState(seed)
        half = neg.size // 2
        fprs = []
        for _ in range(200):
            idx = rng.permutation(neg.size)
            cal, ev = neg[idx[:half]], neg[idx[half:]]
            g = ConformalVetoGate().calibrate(cal, alpha=alpha)
            fprs.append(empirical_fpr(ev, g.threshold))
        thr_all = ConformalVetoGate().calibrate(neg, alpha=alpha).threshold
        veto = {
            "alpha": alpha,
            "threshold_all_negatives": thr_all,
            "mean_realised_fpr": float(np.mean(fprs)),
            "fpr_p95": float(np.percentile(fprs, 95)),
            "n_negatives": int(neg.size),
            "n_splits": 200,
            "small_n_caveat": neg.size < 100,
        }

    return {
        "endpoint": endpoint,
        "status": "SCORED",
        "n_total": len(smiles),
        "n_scored": n,
        "n_unscored": n_unscored,
        "positive_rate": float(np.mean(ys_arr)),
        "auroc": cls["auroc"],
        "auroc_ci95": [auroc_ci["ci_low"], auroc_ci["ci_high"]],
        "auprc": cls["auprc"],
        "brier": cls["brier"],
        "ece": ece,
        "conformal_veto": veto,
    }


def validate_all(predict_prob_factory: Callable[[str], Callable[[str], Optional[float]]],
                 alpha: float = 0.05, max_n: Optional[int] = None) -> dict:
    """Run every endpoint. `predict_prob_factory(endpoint_key) -> predict_prob`."""
    out = {}
    for ep, (_, key) in ENDPOINTS.items():
        out[ep] = validate_endpoint(ep, predict_prob_factory(key), alpha=alpha, max_n=max_n)
    return out
