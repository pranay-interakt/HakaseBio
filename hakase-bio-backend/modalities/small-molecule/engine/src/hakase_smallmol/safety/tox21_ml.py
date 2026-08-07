"""Tox21-ML — the 12-assay Tox21 nuclear-receptor / stress-response panel.

WHY THIS EXISTS
───────────────
Tox21 (Tox21 Data Challenge; Huang et al. 2016, Front. Environ. Sci.) is the
reference public benchmark for early mechanistic toxicity. Its 12 qHTS assays
split into two mechanistic groups that map directly onto L1 safety liabilities:

  Nuclear-receptor (NR) signalling — off-target endocrine / hormonal activity
    NR-AR, NR-AR-LBD   androgen receptor (full + ligand-binding domain)
    NR-ER, NR-ER-LBD   estrogen receptor (full + ligand-binding domain)
    NR-AhR             aryl-hydrocarbon receptor (xenobiotic / dioxin-like)
    NR-Aromatase       CYP19A1 aromatase (estrogen biosynthesis)
    NR-PPAR-gamma      PPARγ (metabolic / adipogenic)
  Stress-response (SR) pathways — cellular-damage reporters
    SR-ARE             antioxidant response element (oxidative stress, Nrf2)
    SR-ATAD5           genotoxic / DNA-damage response
    SR-HSE             heat-shock response (proteotoxic stress)
    SR-MMP             mitochondrial membrane potential (mito-toxicity)
    SR-p53             p53 DNA-damage / tumour-suppressor response

WHAT MAKES THIS SERVING MODEL HONEST (no mocks, no hidden fallbacks)
────────────────────────────────────────────────────────────────────
  1. DATA WITH A REAL HELD-OUT TEST. Each head trains only on the scaffold-split
     TRAIN+VALID rows vendored to `data/tox21_<key>.tab`; the disjoint TEST rows
     live in `validation/datasets/tdc_tox21_<key>_test.csv` and are NEVER read
     for fitting (verified 0.00% SMILES overlap — scripts/vendor_tox21_panel.py).
     Every metric reported by this module (AUROC, AUPRC, Brier, veto FPR/TPR) is
     measured on that untouched test set, so the numbers are trustworthy.

  2. CALIBRATED PROBABILITIES. A class-weight-balanced Random Forest ranks well
     but its raw scores are NOT probabilities. We fit an isotonic regressor on a
     held-out internal calibration split (three-way fit/cal/test, textbook
     inductive setup) so a reported "0.74" means an empirically-observed ~74%
     active rate — reported Brier score proves it. Ranking (AUROC/AUPRC) is
     unchanged; only the magnitudes become meaningful.

  3. FPR-CONTROLLED CONFORMAL VETO. Per head we set the "active" flag threshold
     to the split-conformal (1-α) quantile of the calibration-set INACTIVE
     scores (models.conformal.ConformalVetoGate, Vovk 2005). By exchangeability
     P(flag | inactive) ≤ α; we then report the realised FPR on the independent
     test set as proof. This replaces any hand-picked 0.5 cut with a threshold
     whose false-positive rate on true negatives is bounded by construction.

  4. APPLICABILITY DOMAIN. Every prediction carries the Tanimoto distance to the
     nearest training molecule (shared bit-space with the rest of the L1 model
     family) so out-of-domain extrapolations are flagged, not hidden.

Reuses the shared featurization / AD / persistence plumbing in `_ml_base` so the
Morgan bit-space, descriptor set, and AD semantics match every other L1 head.

References
──────────
  • Huang R. et al. (2016) Front. Environ. Sci. 3:85 — Tox21 qHTS 10k library.
  • Huang R. et al. (2016) Sci. Rep. 6:29551 — Tox21 model benchmarking.
  • Therapeutics Data Commons (Huang et al. 2021, NeurIPS) — Tox21 loader/splits.
  • Niculescu-Mizil & Caruana (2005) ICML — isotonic calibration of RF/boosting.
  • Vovk, Gammerman, Shafer (2005) — split-conformal (the veto guarantee).
"""

from __future__ import annotations

import json
import logging
import os
import pickle
import threading
import time
from dataclasses import dataclass
from typing import Any

import hakase_kernel.base as base
import numpy as np
from hakase_kernel.uncertainty.conformal import ConformalVetoGate, empirical_fpr

logger = logging.getLogger(__name__)

MODEL_VERSION = "1.0.0"

# α for the conformal veto (bound on FPR against true-inactive compounds).
VETO_ALPHA = 0.05
# Fraction of the vendored TRAIN file reserved for isotonic + conformal
# calibration (the remainder fits the forest). Three-way fit/cal/test.
CAL_FRACTION = 0.20
_SEED = 42

# ---------------------------------------------------------------------------
# The 12 Tox21 tasks. `key` is the on-disk suffix (data/tox21_<key>.tab and
# validation/datasets/tdc_tox21_<key>_test.csv). `group` / `name` / `target`
# are surfaced verbatim in the response envelope — no invented biology.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Tox21Task:
    key: str
    label: str  # canonical Tox21 assay id, e.g. "NR-AR"
    group: str  # "Nuclear receptor" | "Stress response"
    name: str  # human-readable pathway name
    target: str  # what an "active" call mechanistically implies


TASKS: tuple[Tox21Task, ...] = (
    Tox21Task(
        "nr_ar",
        "NR-AR",
        "Nuclear receptor",
        "Androgen receptor (full)",
        "Agonism/antagonism of the androgen receptor — endocrine (anti-)androgenic liability.",
    ),
    Tox21Task(
        "nr_ar_lbd",
        "NR-AR-LBD",
        "Nuclear receptor",
        "Androgen receptor (ligand-binding domain)",
        "Direct binding at the AR ligand-binding domain — endocrine androgenic liability.",
    ),
    Tox21Task(
        "nr_ahr",
        "NR-AhR",
        "Nuclear receptor",
        "Aryl-hydrocarbon receptor",
        "AhR activation — dioxin-like xenobiotic response / CYP1A induction.",
    ),
    Tox21Task(
        "nr_aromatase",
        "NR-Aromatase",
        "Nuclear receptor",
        "Aromatase (CYP19A1)",
        "Aromatase modulation — disruption of estrogen biosynthesis.",
    ),
    Tox21Task(
        "nr_er",
        "NR-ER",
        "Nuclear receptor",
        "Estrogen receptor (full)",
        "Estrogen-receptor activity — endocrine (anti-)estrogenic liability.",
    ),
    Tox21Task(
        "nr_er_lbd",
        "NR-ER-LBD",
        "Nuclear receptor",
        "Estrogen receptor (ligand-binding domain)",
        "Direct binding at the ER ligand-binding domain — endocrine estrogenic liability.",
    ),
    Tox21Task(
        "nr_ppar_gamma",
        "NR-PPAR-gamma",
        "Nuclear receptor",
        "PPAR-γ",
        "PPARγ modulation — metabolic/adipogenic off-target activity.",
    ),
    Tox21Task(
        "sr_are",
        "SR-ARE",
        "Stress response",
        "Antioxidant response element (Nrf2)",
        "Oxidative-stress response activation — electrophilic/redox liability.",
    ),
    Tox21Task(
        "sr_atad5",
        "SR-ATAD5",
        "Stress response",
        "ATAD5 genotoxicity reporter",
        "DNA-damage / genotoxic stress response.",
    ),
    Tox21Task(
        "sr_hse",
        "SR-HSE",
        "Stress response",
        "Heat-shock response element",
        "Proteotoxic-stress (heat-shock) response activation.",
    ),
    Tox21Task(
        "sr_mmp",
        "SR-MMP",
        "Stress response",
        "Mitochondrial membrane potential",
        "Disruption of mitochondrial membrane potential — mitochondrial toxicity.",
    ),
    Tox21Task(
        "sr_p53",
        "SR-p53",
        "Stress response",
        "p53 DNA-damage response",
        "p53 pathway activation — DNA-damage / tumour-suppressor stress.",
    ),
)

_TASK_BY_KEY: dict[str, Tox21Task] = {t.key: t for t in TASKS}

_TEST_DIR = os.path.join(os.path.dirname(__file__), "..", "validation", "datasets")
_CALIB_JSON = os.path.join(base.CACHE_DIR, "tox21_calibration.json")


def _cache_path(key: str) -> str:
    return os.path.join(base.CACHE_DIR, f"tox21_{key}_v{MODEL_VERSION}.pkl")


def _test_path(key: str) -> str:
    return os.path.join(_TEST_DIR, f"tdc_tox21_{key}_test.csv")


# ---------------------------------------------------------------------------
# Training (three-way fit / calibration / held-out test)
# ---------------------------------------------------------------------------


def _load_test(key: str) -> tuple[np.ndarray, np.ndarray]:
    """Featurize the disjoint held-out test set for `key`. Never used for fitting."""
    import pandas as pd

    path = _test_path(key)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Tox21 held-out test file missing: {path}")
    df = pd.read_csv(path)
    X, kept = base.featurize_batch(df["Drug"].astype(str).tolist())
    y = df["Y"].to_numpy()[kept].astype(int)
    return X, y


def train_head(key: str) -> dict[str, Any]:
    """Train one Tox21 head and persist its bundle.

    Pipeline: fit RF on the fit split → isotonic-calibrate on the cal split →
    conformal veto threshold on cal-set inactives → measure everything on the
    untouched held-out test set. All reported numbers are test-set numbers.
    """
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.isotonic import IsotonicRegression
    from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
    from sklearn.model_selection import train_test_split

    task = _TASK_BY_KEY[key]
    logger.info("[tox21_%s] loading vendored TRAIN %s ...", key, f"tox21_{key}.tab")
    smiles, y_raw = base.load_tdc_tab(f"tox21_{key}.tab")
    X_all, kept = base.featurize_batch(smiles)
    y_all = np.asarray(y_raw)[kept].astype(int)
    if X_all.shape[0] < 200 or y_all.sum() < 20:
        raise ValueError(
            f"tox21_{key}: insufficient usable training data "
            f"(n={X_all.shape[0]}, positives={int(y_all.sum())})"
        )

    # Three-way split: fit forest on X_fit, calibrate on X_cal, report on test.
    X_fit, X_cal, y_fit, y_cal = train_test_split(
        X_all, y_all, test_size=CAL_FRACTION, random_state=_SEED, stratify=y_all
    )

    clf = RandomForestClassifier(
        n_estimators=300,
        min_samples_leaf=2,
        n_jobs=-1,
        random_state=_SEED,
        class_weight="balanced",
    )
    clf.fit(X_fit, y_fit)

    def _pos_raw(X: np.ndarray) -> np.ndarray:
        proba = clf.predict_proba(X)
        classes = list(clf.classes_)
        if 1 not in classes:
            raise ValueError(f"tox21_{key}: forest never saw the positive class")
        return proba[:, classes.index(1)]

    # Isotonic calibration of the ranked scores → true probabilities.
    raw_cal = _pos_raw(X_cal)
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    iso.fit(raw_cal, y_cal)

    def _calibrated(X: np.ndarray) -> np.ndarray:
        return np.clip(iso.predict(_pos_raw(X)), 0.0, 1.0)

    # Conformal veto: (1-α) quantile of calibrated scores of cal-set INACTIVES.
    cal_neg_scores = _calibrated(X_cal)[y_cal == 0]
    gate = ConformalVetoGate().calibrate(cal_neg_scores, alpha=VETO_ALPHA)

    # ---- Held-out test-set evaluation (untouched during all fitting above) ----
    X_te, y_te = _load_test(key)
    p_te = _calibrated(X_te)
    auroc = float(roc_auc_score(y_te, p_te)) if len(set(y_te.tolist())) > 1 else None
    auprc = float(average_precision_score(y_te, p_te)) if y_te.sum() > 0 else None
    brier = float(brier_score_loss(y_te, p_te))
    test_neg = p_te[y_te == 0]
    test_pos = p_te[y_te == 1]
    realised_fpr = empirical_fpr(test_neg, gate.threshold) if test_neg.size else None
    realised_tpr = (
        float(np.mean(test_pos > gate.threshold))
        if test_pos.size and np.isfinite(gate.threshold)
        else None
    )

    training_fps = X_fit[:, : base.MORGAN_NBITS].astype(np.float32)

    bundle: dict[str, Any] = {
        "version": MODEL_VERSION,
        "key": key,
        "label": task.label,
        "group": task.group,
        "name": task.name,
        "target": task.target,
        "model": clf,
        "isotonic": iso,
        "veto_threshold": float(gate.threshold),
        "veto_alpha": VETO_ALPHA,
        "n_fit": int(X_fit.shape[0]),
        "n_cal": int(X_cal.shape[0]),
        "n_cal_negatives": int((y_cal == 0).sum()),
        "n_train_total": int(X_all.shape[0]),
        "n_positives_train": int(y_all.sum()),
        "pos_rate_train": float(y_all.mean()),
        "n_test": int(X_te.shape[0]),
        "n_positives_test": int(y_te.sum()),
        "test_auroc": auroc,
        "test_auprc": auprc,
        "test_brier": brier,
        "veto_realised_fpr_test": realised_fpr,
        "veto_realised_tpr_test": realised_tpr,
        "morgan_nbits": base.MORGAN_NBITS,
        "morgan_radius": base.MORGAN_RADIUS,
        "trained_at": time.time(),
        "training_fps": training_fps,
    }

    os.makedirs(base.CACHE_DIR, exist_ok=True)
    with open(_cache_path(key), "wb") as f:
        pickle.dump(bundle, f)
    logger.info(
        "[tox21_%s] cached — test AUROC=%s AUPRC=%s Brier=%.3f vetoFPR=%s",
        key,
        f"{auroc:.3f}" if auroc else "n/a",
        f"{auprc:.3f}" if auprc else "n/a",
        brier,
        f"{realised_fpr:.3f}" if realised_fpr is not None else "n/a",
    )
    return bundle


# ---------------------------------------------------------------------------
# Lazy per-head loader (trains on first use if no cache, like _ml_base.load)
# ---------------------------------------------------------------------------

_STATES: dict[str, dict[str, Any]] = {}
_LOCK = threading.Lock()


def load_head(key: str) -> dict[str, Any]:
    if key not in _TASK_BY_KEY:
        raise KeyError(f"unknown Tox21 task {key!r}; valid keys: {sorted(_TASK_BY_KEY)}")
    st = _STATES.get(key)
    if st is not None:
        return st
    with _LOCK:
        st = _STATES.get(key)
        if st is not None:
            return st
        path = _cache_path(key)
        if os.path.exists(path):
            with open(path, "rb") as f:
                bundle = pickle.load(f)
            if bundle.get("version") != MODEL_VERSION:
                bundle = train_head(key)
        else:
            bundle = train_head(key)
        _STATES[key] = bundle
        return bundle


# ---------------------------------------------------------------------------
# Inference
# ---------------------------------------------------------------------------


def _predict_one(bundle: dict[str, Any], feats: np.ndarray) -> tuple[float, bool]:
    clf = bundle["model"]
    iso = bundle["isotonic"]
    classes = list(clf.classes_)
    raw = float(clf.predict_proba(feats.reshape(1, -1))[0][classes.index(1)])
    prob = float(np.clip(iso.predict([raw])[0], 0.0, 1.0))
    thr = bundle["veto_threshold"]
    flag = bool(np.isfinite(thr) and prob > thr)
    return prob, flag


def _head_envelope(
    bundle: dict[str, Any], prob: float, flag: bool, ad: dict[str, Any]
) -> dict[str, Any]:
    return {
        "assay": bundle["label"],
        "group": bundle["group"],
        "pathway": bundle["name"],
        "mechanistic_meaning": bundle["target"],
        "active_probability": round(prob, 4),
        "active_flag": flag,
        "flag_basis": (
            f"calibrated P(active)={prob:.3f} vs conformal veto threshold "
            f"{bundle['veto_threshold']:.3f} (α={bundle['veto_alpha']}, "
            f"FPR bounded ≤{bundle['veto_alpha']} on true inactives)"
        ),
        "applicability_domain": base.ad_envelope(ad),
        "head_performance": {
            "test_auroc": bundle["test_auroc"],
            "test_auprc": bundle["test_auprc"],
            "test_brier": bundle["test_brier"],
            "veto_realised_fpr_test": bundle["veto_realised_fpr_test"],
            "veto_realised_tpr_test": bundle["veto_realised_tpr_test"],
            "n_test": bundle["n_test"],
            "n_positives_test": bundle["n_positives_test"],
        },
    }


def predict_tox21_head(smiles: str, key: str) -> dict[str, Any]:
    """Predict a single Tox21 assay for one SMILES."""
    if not smiles or not smiles.strip():
        raise ValueError("smiles is required")
    canon = base.canonicalize(smiles.strip())
    if canon is None:
        return {
            "smiles": smiles,
            "source": "fallback",
            "ml_available": False,
            "error": "rdkit_could_not_parse_smiles",
        }
    feats = base.featurize(canon)
    if feats is None:
        return {
            "smiles": canon,
            "source": "fallback",
            "ml_available": False,
            "error": "rdkit_could_not_parse_smiles",
        }
    try:
        bundle = load_head(key)
    except Exception as exc:  # noqa: BLE001
        return {
            "smiles": canon,
            "source": "fallback",
            "ml_available": False,
            "error": f"model_load_failed: {exc}",
        }
    prob, flag = _predict_one(bundle, feats)
    ad = base.compute_ad(bundle, feats)
    return {
        "smiles": canon,
        "source": "ml",
        "ml_available": True,
        "prediction": _head_envelope(bundle, prob, flag, ad),
        "model_info": _model_info(bundle),
    }


def predict_tox21_panel(smiles: str) -> dict[str, Any]:
    """Predict all 12 Tox21 assays for one SMILES + a mechanistic summary.

    The summary is transparent aggregation only — it counts assays whose
    calibrated probability clears its own FPR-controlled veto threshold and the
    single highest-probability liability. It invents no composite score.
    """
    if not smiles or not smiles.strip():
        raise ValueError("smiles is required")
    canon = base.canonicalize(smiles.strip())
    if canon is None:
        return {
            "smiles": smiles,
            "source": "fallback",
            "ml_available": False,
            "error": "rdkit_could_not_parse_smiles",
        }
    feats = base.featurize(canon)
    if feats is None:
        return {
            "smiles": canon,
            "source": "fallback",
            "ml_available": False,
            "error": "rdkit_could_not_parse_smiles",
        }

    heads: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for task in TASKS:
        try:
            bundle = load_head(task.key)
        except Exception as exc:  # noqa: BLE001
            errors.append({"assay": task.label, "error": f"{type(exc).__name__}: {exc}"})
            continue
        prob, flag = _predict_one(bundle, feats)
        ad = base.compute_ad(bundle, feats)
        heads.append(_head_envelope(bundle, prob, flag, ad))

    flagged = [h for h in heads if h["active_flag"]]
    # Only count an in-domain flag toward the hard summary; out-of-domain flags
    # are surfaced but explicitly not allowed to drive a confident conclusion.
    flagged_in_domain = [h for h in flagged if h["applicability_domain"]["ad_in_domain"] is True]
    top = max(heads, key=lambda h: h["active_probability"]) if heads else None

    return {
        "smiles": canon,
        "source": "ml",
        "ml_available": len(heads) > 0,
        "panel": heads,
        "panel_errors": errors,
        "summary": {
            "n_assays_evaluated": len(heads),
            "n_flagged": len(flagged),
            "n_flagged_in_domain": len(flagged_in_domain),
            "flagged_assays": [h["assay"] for h in flagged],
            "flagged_assays_in_domain": [h["assay"] for h in flagged_in_domain],
            "top_liability": (
                {
                    "assay": top["assay"],
                    "pathway": top["pathway"],
                    "active_probability": top["active_probability"],
                    "in_domain": top["applicability_domain"]["ad_in_domain"],
                }
                if top
                else None
            ),
            "interpretation": (
                "Each assay flag has a per-assay false-positive rate bounded at "
                f"α={VETO_ALPHA} on true inactives (conformal). Flags are mechanistic "
                "signals for triage/mechanism-of-toxicity, not a standalone GO/NO-GO."
            ),
        },
        "model_info": {
            "engine": f"Tox21-ML v{MODEL_VERSION} (12-assay panel; RF + isotonic calibration + conformal veto)",
            "method": "RandomForest(Morgan1024+6 RDKit desc) ranked, isotonic-calibrated, "
            "FPR-controlled conformal veto per assay",
            "dataset": "TDC Tox21 (Huang et al. 2016; scaffold split, disjoint held-out test)",
            "license": "MIT (HakaseAI internal); training data CC-BY 4.0 (TDC)",
        },
    }


def _model_info(bundle: dict[str, Any]) -> dict[str, Any]:
    return {
        "engine": f"Tox21-ML v{MODEL_VERSION} — {bundle['label']} ({bundle['name']})",
        "method": "RandomForest(Morgan1024+6 RDKit desc), isotonic-calibrated, FPR-controlled conformal veto",
        "dataset": "TDC Tox21 (Huang et al. 2016; scaffold split, disjoint held-out test)",
        "training": {
            "n_fit": bundle["n_fit"],
            "n_calibration": bundle["n_cal"],
            "n_train_total": bundle["n_train_total"],
            "pos_rate_train": round(bundle["pos_rate_train"], 4),
        },
        "performance_heldout_test": {
            "test_auroc": bundle["test_auroc"],
            "test_auprc": bundle["test_auprc"],
            "test_brier": bundle["test_brier"],
            "veto_alpha": bundle["veto_alpha"],
            "veto_realised_fpr_test": bundle["veto_realised_fpr_test"],
            "veto_realised_tpr_test": bundle["veto_realised_tpr_test"],
            "n_test": bundle["n_test"],
        },
        "features": {
            "morgan_nbits": bundle["morgan_nbits"],
            "morgan_radius": bundle["morgan_radius"],
            "rdkit_descriptors": base.DESCRIPTOR_NAMES,
        },
        "license": "MIT (HakaseAI internal); training data CC-BY 4.0 (TDC)",
    }


# ---------------------------------------------------------------------------
# Status / warmup / calibration-report (parallels the rest of the model family)
# ---------------------------------------------------------------------------


def is_ready() -> dict[str, Any]:
    ready = {}
    unavailable: dict[str, str] = {}
    for task in TASKS:
        cached = os.path.exists(_cache_path(task.key)) or task.key in _STATES
        ready[task.key] = cached
        if not cached:
            missing: list[str] = []
            if base.resolve_dataset(f"tox21_{task.key}.tab") is None:
                missing.append(f"training dataset tox21_{task.key}.tab")
            if not os.path.exists(_test_path(task.key)):
                missing.append(f"held-out test set {os.path.basename(_test_path(task.key))}")
            unavailable[task.key] = (
                "missing " + " and ".join(missing)
                if missing
                else "not loaded yet; warmup will train the head"
            )
    return {
        "loaded_heads": ready,
        "n_ready": sum(ready.values()),
        "n_total": len(TASKS),
        "unavailable_reasons": unavailable,
    }


def warmup() -> dict[str, Any]:
    """Force-train/load every head. Writes a consolidated calibration report."""
    out: dict[str, Any] = {}
    report: dict[str, Any] = {}
    for task in TASKS:
        try:
            b = load_head(task.key)
            out[task.key] = {
                "status": "ready",
                "test_auroc": b["test_auroc"],
                "test_auprc": b["test_auprc"],
                "test_brier": b["test_brier"],
                "veto_realised_fpr_test": b["veto_realised_fpr_test"],
            }
            report[task.key] = {
                "label": b["label"],
                "group": b["group"],
                "name": b["name"],
                "n_fit": b["n_fit"],
                "n_cal": b["n_cal"],
                "n_test": b["n_test"],
                "pos_rate_train": b["pos_rate_train"],
                "test_auroc": b["test_auroc"],
                "test_auprc": b["test_auprc"],
                "test_brier": b["test_brier"],
                "veto_alpha": b["veto_alpha"],
                "veto_threshold": b["veto_threshold"],
                "veto_realised_fpr_test": b["veto_realised_fpr_test"],
                "veto_realised_tpr_test": b["veto_realised_tpr_test"],
            }
        except Exception as exc:  # noqa: BLE001
            out[task.key] = {"status": "error", "error": str(exc)}
    if report:
        os.makedirs(base.CACHE_DIR, exist_ok=True)
        with open(_CALIB_JSON, "w") as f:
            json.dump(
                {
                    "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "model_version": MODEL_VERSION,
                    "veto_alpha": VETO_ALPHA,
                    "cal_fraction": CAL_FRACTION,
                    "method": "RF(Morgan1024+6desc) + isotonic calibration + split-conformal veto "
                    "(models.conformal.ConformalVetoGate); metrics on disjoint scaffold-split test",
                    "heads": report,
                },
                f,
                indent=2,
            )
    return out


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    import sys

    keys = sys.argv[1:] or [t.key for t in TASKS]
    for k in keys:
        b = train_head(k)
        print(
            f"{b['label']:14} AUROC={b['test_auroc']:.3f} AUPRC={b['test_auprc']:.3f} "
            f"Brier={b['test_brier']:.3f} vetoFPR={b['veto_realised_fpr_test']} "
            f"vetoTPR={b['veto_realised_tpr_test']} n_test={b['n_test']}"
        )
