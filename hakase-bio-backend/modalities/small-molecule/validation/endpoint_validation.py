"""§2 — validate EVERY displayed ADMET endpoint against measured TDC test data.

Each endpoint the app shows is checked against its TDC scaffold-split TEST set
(the standard Hakase ADMET hold-out, frozen in validation/datasets/). Predictions
come from the LIVE ai-service Hakase ADMET head; molecules the model can't score are
skipped, never imputed.

  • Binary endpoints (hERG, AMES, DILI, BBB, P-gp, F, 5×CYP, ClinTox, Carcinogen)
    → AUROC (+95% bootstrap CI), AUPRC, Brier, ECE, + conformal FPR-controlled
      veto threshold.
  • Regression endpoints (Caco-2, logD, solubility, PPB, VDss, CL, t½, LD50)
    → R² and Spearman (+95% CI), MAE; and geometric-mean FOLD-ERROR for the
      strictly-positive linear ones (VDss, CL, t½) — the standard PK accuracy
      readout ("within 2-/3-fold").

Every number is real predictions vs real measured labels — nothing fabricated.
"""

from __future__ import annotations

import csv
import os
from collections.abc import Callable

import numpy as np
from hakase_kernel.uncertainty.conformal import ConformalVetoGate, empirical_fpr

from validation import metrics as M

_HERE = os.path.dirname(os.path.abspath(__file__))
DATASET_DIR = os.path.join(_HERE, "datasets")


# Panel: display name → config.
#   tdc      = TDC dataset name           cls = 'Tox' | 'ADME'
#   admet_key= Hakase ADMET output column     kind= 'binary' | 'reg'
#   fold     = (reg only) value is strictly-positive linear → report fold-error
PANEL: dict[str, dict] = {
    # ── Safety / toxicity (binary) ──
    "hERG": {"tdc": "hERG", "cls": "Tox", "admet_key": "hERG", "kind": "binary"},
    "AMES": {"tdc": "AMES", "cls": "Tox", "admet_key": "AMES", "kind": "binary"},
    "DILI": {"tdc": "DILI", "cls": "Tox", "admet_key": "DILI", "kind": "binary"},
    "ClinTox": {"tdc": "ClinTox", "cls": "Tox", "admet_key": "ClinTox", "kind": "binary"},
    "Carcinogens": {
        "tdc": "Carcinogens_Lagunin",
        "cls": "Tox",
        "admet_key": "Carcinogens_Lagunin",
        "kind": "binary",
    },
    # ── Absorption / distribution / metabolism (binary) ──
    "BBB": {"tdc": "BBB_Martins", "cls": "ADME", "admet_key": "BBB_Martins", "kind": "binary"},
    "Pgp_inhibition": {
        "tdc": "Pgp_Broccatelli",
        "cls": "ADME",
        "admet_key": "Pgp_Broccatelli",
        "kind": "binary",
    },
    "Bioavailability": {
        "tdc": "Bioavailability_Ma",
        "cls": "ADME",
        "admet_key": "Bioavailability_Ma",
        "kind": "binary",
    },
    "CYP1A2": {"tdc": "CYP1A2_Veith", "cls": "ADME", "admet_key": "CYP1A2_Veith", "kind": "binary"},
    "CYP2C9": {"tdc": "CYP2C9_Veith", "cls": "ADME", "admet_key": "CYP2C9_Veith", "kind": "binary"},
    "CYP2C19": {
        "tdc": "CYP2C19_Veith",
        "cls": "ADME",
        "admet_key": "CYP2C19_Veith",
        "kind": "binary",
    },
    "CYP2D6": {"tdc": "CYP2D6_Veith", "cls": "ADME", "admet_key": "CYP2D6_Veith", "kind": "binary"},
    "CYP3A4": {"tdc": "CYP3A4_Veith", "cls": "ADME", "admet_key": "CYP3A4_Veith", "kind": "binary"},
    # ── Regression (continuous) ──
    "Caco2": {
        "tdc": "Caco2_Wang",
        "cls": "ADME",
        "admet_key": "Caco2_Wang",
        "kind": "reg",
        "fold": False,
    },
    "Lipophilicity": {
        "tdc": "Lipophilicity_AstraZeneca",
        "cls": "ADME",
        "admet_key": "Lipophilicity_AstraZeneca",
        "kind": "reg",
        "fold": False,
    },
    "Solubility": {
        "tdc": "Solubility_AqSolDB",
        "cls": "ADME",
        "admet_key": "Solubility_AqSolDB",
        "kind": "reg",
        "fold": False,
    },
    "PPB": {"tdc": "PPBR_AZ", "cls": "ADME", "admet_key": "PPBR_AZ", "kind": "reg", "fold": False},
    "VDss": {
        "tdc": "VDss_Lombardo",
        "cls": "ADME",
        "admet_key": "VDss_Lombardo",
        "kind": "reg",
        "fold": True,
    },
    "Clearance": {
        "tdc": "Clearance_Hepatocyte_AZ",
        "cls": "ADME",
        "admet_key": "Clearance_Hepatocyte_AZ",
        "kind": "reg",
        "fold": True,
    },
    "HalfLife": {
        "tdc": "Half_Life_Obach",
        "cls": "ADME",
        "admet_key": "Half_Life_Obach",
        "kind": "reg",
        "fold": True,
    },
    "LD50": {
        "tdc": "LD50_Zhu",
        "cls": "Tox",
        "admet_key": "LD50_Zhu",
        "kind": "reg",
        "fold": False,
    },
}

# Backwards-compat alias (the 3 headline safety endpoints).
ENDPOINTS = {
    k: (PANEL[k]["tdc"].lower().replace("_", ""), PANEL[k]["admet_key"])
    for k in ("hERG", "AMES", "DILI")
}


def _csv_path(name: str) -> str:
    return os.path.join(DATASET_DIR, f"tdc_{name.lower()}_test.csv")


def load_tdc_test(name: str) -> tuple[list[str], list[float]]:
    """(smiles, Y) for the frozen TDC TEST split of `name` (PANEL key). Falls
    back to live PyTDC only if the frozen CSV is absent; raises otherwise."""
    if name not in PANEL:
        raise ValueError(f"unknown endpoint {name!r}")
    path = _csv_path(name)
    if os.path.exists(path):
        smiles, ys = [], []
        with open(path, newline="") as f:
            for row in csv.DictReader(f):
                smiles.append(row["Drug"])
                ys.append(float(row["Y"]))
        return smiles, ys
    try:
        from tdc.single_pred import ADME, Tox  # type: ignore

        loader = Tox if PANEL[name]["cls"] == "Tox" else ADME
        te = loader(name=PANEL[name]["tdc"]).get_split()["test"]
        return te["Drug"].tolist(), [float(v) for v in te["Y"].tolist()]
    except Exception as e:  # noqa: BLE001
        raise FileNotFoundError(f"No frozen split at {path} and PyTDC unavailable ({e}).")


def validate_endpoint(
    name: str,
    predict_value: Callable[[str], float | None],
    alpha: float = 0.05,
    max_n: int | None = None,
    seed: int = 0,
) -> dict:
    """Score one endpoint (binary or regression) end-to-end."""
    cfg = PANEL[name]
    smiles, ys_all = load_tdc_test(name)
    if max_n:
        smiles, ys_all = smiles[:max_n], ys_all[:max_n]
    preds: list[float] = []
    ys: list[float] = []
    n_unscored = 0
    for smi, y in zip(smiles, ys_all, strict=False):
        v = predict_value(smi)
        if v is None or not np.isfinite(v):
            n_unscored += 1
            continue
        preds.append(float(v))
        ys.append(float(y))
    n = len(ys)
    if n < 20:
        return {"endpoint": name, "kind": cfg["kind"], "status": "INSUFFICIENT", "n_scored": n}

    pr = np.asarray(preds)
    yt = np.asarray(ys)
    out = {
        "endpoint": name,
        "kind": cfg["kind"],
        "status": "SCORED",
        "n_total": len(smiles),
        "n_scored": n,
        "n_unscored": n_unscored,
    }

    if cfg["kind"] == "binary":
        if len(set(int(v) for v in ys)) < 2:
            return {**out, "status": "INSUFFICIENT", "reason": "one class only"}
        cls = M.classification_metrics(yt, pr, threshold=0.5)
        out.update(
            {
                "auroc": cls["auroc"],
                "auroc_ci95": list(
                    M.bootstrap_ci(yt, pr, lambda t, p: M.auroc(t, p), seed=seed).values()
                )[1:3],
                "auprc": cls["auprc"],
                "brier": cls["brier"],
                "ece": M.expected_calibration_error(yt, pr)["ece"],
                "positive_rate": float(np.mean(yt)),
            }
        )
        neg = pr[yt == 0]
        if neg.size >= 20:
            rng = np.random.RandomState(seed)
            half = neg.size // 2
            fprs = []
            for _ in range(200):
                idx = rng.permutation(neg.size)
                g = ConformalVetoGate().calibrate(neg[idx[:half]], alpha=alpha)
                fprs.append(empirical_fpr(neg[idx[half:]], g.threshold))
            out["conformal_veto"] = {
                "alpha": alpha,
                "threshold_all_negatives": ConformalVetoGate()
                .calibrate(neg, alpha=alpha)
                .threshold,
                "mean_realised_fpr": float(np.mean(fprs)),
                "n_negatives": int(neg.size),
                "small_n_caveat": neg.size < 100,
            }
    else:  # regression
        reg = M.regression_metrics(yt, pr)
        r2_ci = M.bootstrap_ci(yt, pr, lambda t, p: M.regression_metrics(t, p)["r2"], seed=seed)
        out.update(
            {
                "r2": reg["r2"],
                "r2_ci95": [r2_ci["ci_low"], r2_ci["ci_high"]],
                "spearman": reg["spearman"],
                "mae": reg["mae"],
                "rmse": reg["rmse"],
            }
        )
        if cfg.get("fold") and np.all(yt > 0) and np.all(pr > 0):
            out["fold_error"] = M.fold_error_metrics(yt, pr)
    return out


def validate_all(
    predict_value_factory: Callable[[str], Callable[[str], float | None]],
    alpha: float = 0.05,
    max_n: int | None = None,
    only: list[str] | None = None,
) -> dict:
    """Run the whole panel. `predict_value_factory(admet_key) -> predict_value`."""
    out = {}
    for name, cfg in PANEL.items():
        if only and name not in only:
            continue
        out[name] = validate_endpoint(
            name, predict_value_factory(cfg["admet_key"]), alpha=alpha, max_n=max_n
        )
    return out
