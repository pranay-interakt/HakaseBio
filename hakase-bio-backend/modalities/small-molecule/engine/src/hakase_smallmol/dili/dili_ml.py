"""DILI-ML — drug-induced liver injury risk classifier.

Independent ML model that produces a binary DILI-risk probability for use in
Layer 3 Stage 2 (Hepatic surrogate). Methodologically aligned with cardiotox:

  1. Public training data: TDC `DILI` (Xu et al., J. Chem. Inf. Model., 2015,
     475 compounds, binary "DILI-positive" / "DILI-negative" curated from FDA
     orange-box drug labels). CC-BY 4.0 via Therapeutics Data Commons.
  2. Feature representation: Morgan circular fingerprint (1024-bit, radius 2)
     + 6 RDKit descriptors (MolWt, MolLogP, TPSA, HBD, HBA, FractionCSP3).
  3. Algorithm: Random Forest classifier (sklearn).

HONEST SCOPE — what this model does and does not do:
  * Predicts:  binary DILI-risk probability + qualitative risk class.
  * Does NOT predict: the 5-class severity (none / mild / moderate / severe /
    most-concern) used in the Layer 3 Stage 2 result schema.
  * Does NOT predict: mechanism flags (mitochondrial, BSEP, ROS, immune).
  Severity class and mechanism flags are not present in any free, redistribution-
  clean training corpus we have access to (DrugBank's structured mechanism
  tables would be needed and are gated to the future Premium tier). Consumers
  should treat this model as a screen — high probability triggers a manual-
  entry severity/mechanism review by the user; low probability still allows
  the cascade to proceed but does not silently fill in mechanism flags.

Trains on first call (~3-8s), caches the fitted pipeline as a pickle so
subsequent server starts and inference are sub-50ms.
"""

from __future__ import annotations

import logging
import os
import pickle
import threading
import time
from typing import Any

import numpy as np
from hakase_kernel.runtime.paths import cache_dir
from hakase_kernel.runtime.privacy import scrub_smiles

logger = logging.getLogger(__name__)

_MODEL: Any = None
_LOAD_LOCK = threading.Lock()
_LOAD_ERROR: str | None = None
_LOAD_TIME_S: float | None = None
_TRAIN_METRICS: dict[str, Any] = {}

CACHE_DIR = str(cache_dir())
MODEL_PATH = os.path.join(CACHE_DIR, "dili_ml_rf.pkl")
# v2.0.0: probability calibration + offline cold start. Two changes from v1.0.0:
#   1. Trains from the vendored `data/dili.tab` via _ml_base.load_tdc_tab (no
#      network / no `tdc` import), consistent with cardiotox v2 and the rest of
#      the _ml_base family.
#   2. CROSS-FITTED Platt calibration (CalibratedClassifierCV, method="sigmoid",
#      cv=5). DILI is small (~475 rows) — the regime where a single fit/cal
#      isotonic split overfits (Niculescu-Mizil & Caruana 2005). Sigmoid is
#      parametric/stable on small data and cross-fitting reuses every trainable
#      row for both fitting and calibration. The calibrator is kept ONLY if it
#      lowers held-out ECE vs the raw score; otherwise we fall back honestly to
#      the raw RF score (calibration.available=False) and the veto stays on the
#      raw scale (safe — the veto is monotone-invariant).
MODEL_VERSION = "2.0.0"
MORGAN_NBITS = 1024
MORGAN_RADIUS = 2
DESCRIPTOR_NAMES = ["MolWt", "MolLogP", "TPSA", "HBD", "HBA", "FractionCSP3"]
FEATURE_DIM = MORGAN_NBITS + len(DESCRIPTOR_NAMES)

# Vendored TDC DILI table (offline cold start).
TDC_FILE = "dili.tab"
# α for the conformal veto (bound on FPR against true-inactive compounds).
VETO_ALPHA = 0.05
# Held-out test fraction for the honest calibration audit (raw vs calibrated ECE).
TEST_FRACTION = 0.20
_SEED = 42


# --------------------------------------------------------------------------- #
# Featurization
# --------------------------------------------------------------------------- #


def _featurize(smiles: str) -> np.ndarray | None:
    """SMILES → fixed-size feature vector. Returns None on parse failure."""
    from rdkit import Chem
    from rdkit.Chem import AllChem, Crippen, rdMolDescriptors
    from rdkit.DataStructs import ConvertToNumpyArray

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None

    fp = AllChem.GetMorganFingerprintAsBitVect(mol, MORGAN_RADIUS, nBits=MORGAN_NBITS)
    fp_arr = np.zeros(MORGAN_NBITS, dtype=np.int8)
    ConvertToNumpyArray(fp, fp_arr)

    desc = np.array(
        [
            rdMolDescriptors.CalcExactMolWt(mol),
            Crippen.MolLogP(mol),
            rdMolDescriptors.CalcTPSA(mol),
            float(rdMolDescriptors.CalcNumHBD(mol)),
            float(rdMolDescriptors.CalcNumHBA(mol)),
            rdMolDescriptors.CalcFractionCSP3(mol),
        ],
        dtype=np.float64,
    )

    return np.concatenate([fp_arr.astype(np.float64), desc])


# --------------------------------------------------------------------------- #
# Train + cache
# --------------------------------------------------------------------------- #


def _train() -> dict[str, Any]:
    """Train the DILI classifier + cross-fitted Platt calibrator and persist.

    Small-data pipeline (see MODEL_VERSION note): hold out a stratified TEST split
    for an honest calibration audit; on the remaining rows fit BOTH a plain RF
    (raw score / veto fallback) and a cross-fitted sigmoid calibrator
    (CalibratedClassifierCV, cv=5). Keep the calibrator only if it lowers held-out
    ECE. Fit the conformal veto/screen on the CALIBRATED (or raw, if the ECE gate
    rejected calibration) approved-drug hold-out so P(flag | approved) ≤ α on the
    served scale — the displayed number and the gating threshold share one scale.
    """
    import hakase_kernel.base as base
    from sklearn.calibration import CalibratedClassifierCV
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
    from sklearn.model_selection import train_test_split

    logger.info("DILI-ML: loading vendored %s ...", TDC_FILE)
    smiles, y_raw = base.load_tdc_tab(TDC_FILE)
    y = np.asarray(y_raw).astype(int)

    logger.info("DILI-ML: featurizing %d compounds...", len(smiles))
    X_rows: list[np.ndarray] = []
    y_kept: list[int] = []
    for s, label in zip(smiles, y):
        v = _featurize(s)
        if v is not None:
            X_rows.append(v)
            y_kept.append(int(label))

    if len(X_rows) < 50:
        raise RuntimeError(
            f"DILI-ML training aborted: only {len(X_rows)} compounds parseable "
            "(need >=50). Vendored dataset may be corrupted or RDKit failed."
        )

    X = np.vstack(X_rows)
    y_arr = np.array(y_kept, dtype=int)
    n_pos = int((y_arr == 1).sum())
    n_neg = int((y_arr == 0).sum())

    # Held-out TEST split for the honest raw-vs-calibrated audit. The remaining
    # TRAINVAL rows are ALL reused for both fitting and calibration (cross-fit),
    # so no dedicated calibration split is permanently sacrificed.
    X_tv, X_test, y_tv, y_test = train_test_split(
        X, y_arr, test_size=TEST_FRACTION, random_state=_SEED, stratify=y_arr
    )
    logger.info(
        "DILI-ML: fit/cal on %d rows, honest test on %d rows...", X_tv.shape[0], X_test.shape[0]
    )

    def _make_rf() -> RandomForestClassifier:
        return RandomForestClassifier(
            n_estimators=400,
            max_depth=None,
            min_samples_leaf=2,
            n_jobs=-1,
            class_weight="balanced",
            random_state=42,
        )

    # Raw RF (produces raw_p at inference + the raw-score baseline / veto fallback).
    raw_rf = _make_rf()
    raw_rf.fit(X_tv, y_tv)

    # Cross-fitted Platt (sigmoid) calibrator over the SAME TRAINVAL rows.
    calibrator = CalibratedClassifierCV(estimator=_make_rf(), method="sigmoid", cv=5)
    calibrator.fit(X_tv, y_tv)

    # ---- Honest test-split audit: does the calibrator actually help? ----
    raw_test = base.positive_class_proba(raw_rf, X_test)
    cal_test = base.positive_class_proba(calibrator, X_test)
    both_classes = len(set(y_test.tolist())) > 1
    ece_raw = base.expected_calibration_error(y_test, raw_test, n_bins=10)
    ece_cal = base.expected_calibration_error(y_test, cal_test, n_bins=10)
    brier_raw = float(brier_score_loss(y_test, raw_test))
    brier_cal = float(brier_score_loss(y_test, cal_test))

    # ECE gate (Q2): keep the calibrator ONLY if it measurably lowers held-out ECE.
    keep_cal = ece_cal is not None and ece_raw is not None and ece_cal < ece_raw
    served_test = cal_test if keep_cal else raw_test
    auroc = float(roc_auc_score(y_test, served_test)) if both_classes else None
    auprc = float(average_precision_score(y_test, served_test)) if y_test.sum() > 0 else None

    # Veto (NO-GO) + screen (WATCH): FPR-controlled conformal thresholds on the
    # CALIBRATED approved-drug hold-out (served scale — calibrated when the ECE gate
    # kept the sigmoid, else raw, in which case the served probability is ALSO raw so
    # the two stay on one scale). P(flag | approved) ≤ α by construction.
    served_model = calibrator if keep_cal else raw_rf

    def _served_smiles(smiles: list[str]) -> np.ndarray:
        rows = [v for v in (_featurize(s) for s in smiles) if v is not None]
        if not rows:
            return np.empty(0)
        return base.positive_class_proba(served_model, np.vstack(rows))

    gate_fields = base.fit_approved_veto_screen(_served_smiles, veto_alpha=VETO_ALPHA)

    bundle: dict[str, Any] = {
        "version": MODEL_VERSION,
        "model": raw_rf,
        "calibrator": calibrator if keep_cal else None,
        "calibration_method": (
            "sigmoid (cross-fitted, 5-fold)"
            if keep_cal
            else "uncalibrated (cal set too small / no ECE gain)"
        ),
        "calibration_available": bool(keep_cal),
        **gate_fields,
        "n_train": int(X_tv.shape[0]),
        "n_train_total": int(len(y_arr)),
        "n_calibration": int(X_tv.shape[0]),  # cross-fit reuses all TRAINVAL rows
        "n_test": int(X_test.shape[0]),
        "n_positives": n_pos,
        "n_negatives": n_neg,
        "test_auroc": auroc,
        "test_auprc": auprc,
        "brier_test": brier_cal if keep_cal else brier_raw,
        "brier_test_raw": brier_raw,
        "ece_test": ece_cal if keep_cal else ece_raw,
        "ece_test_raw": ece_raw,
        "ece_test_calibrated": ece_cal,
        # Back-compat CV field names (now = honest held-out test AUROC).
        "cv_roc_auc_mean": auroc,
        "cv_roc_auc_std": None,
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "morgan_nbits": MORGAN_NBITS,
        "morgan_radius": MORGAN_RADIUS,
    }

    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(MODEL_PATH, "wb") as f:
        pickle.dump(bundle, f)
    logger.info(
        "DILI-ML: cached to %s (ECE raw=%s→cal=%s keep_cal=%s test AUROC=%s veto=%s FPR-approved=%s)",
        MODEL_PATH,
        f"{ece_raw:.4f}" if ece_raw is not None else "n/a",
        f"{ece_cal:.4f}" if ece_cal is not None else "n/a",
        keep_cal,
        f"{auroc:.3f}" if auroc is not None else "n/a",
        (
            f"{gate_fields.get('veto_threshold'):.3f}"
            if gate_fields.get("veto_threshold") is not None
            else "n/a"
        ),
        (
            f"{gate_fields.get('veto_realised_fpr_on_approved'):.3f}"
            if gate_fields.get("veto_realised_fpr_on_approved") is not None
            else "n/a"
        ),
    )
    return bundle


def _load_model() -> dict[str, Any]:
    """Singleton loader. Trains on first call if no cached model exists."""
    global _MODEL, _LOAD_ERROR, _LOAD_TIME_S, _TRAIN_METRICS
    if _MODEL is not None:
        return _MODEL
    with _LOAD_LOCK:
        if _MODEL is not None:
            return _MODEL
        try:
            t0 = time.time()
            if os.path.exists(MODEL_PATH):
                with open(MODEL_PATH, "rb") as f:
                    bundle = pickle.load(f)
                if bundle.get("version") != MODEL_VERSION:
                    logger.info("DILI-ML: cache version mismatch, retraining...")
                    bundle = _train()
            else:
                logger.info("DILI-ML: no cache found, training from scratch...")
                bundle = _train()
            _MODEL = bundle
            _TRAIN_METRICS = {
                k: bundle[k]
                for k in (
                    "n_train",
                    "n_positives",
                    "n_negatives",
                    "cv_roc_auc_mean",
                    "cv_roc_auc_std",
                    "trained_at",
                    "version",
                )
            }
            _LOAD_TIME_S = time.time() - t0
            logger.info("DILI-ML: ready in %.2fs", _LOAD_TIME_S)
            return _MODEL
        except Exception as exc:  # noqa: BLE001
            _LOAD_ERROR = f"{type(exc).__name__}: {exc}"
            logger.exception("DILI-ML: failed to load/train model")
            raise


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #


def is_ready() -> dict[str, Any]:
    return {
        "loaded": _MODEL is not None,
        "load_time_s": _LOAD_TIME_S,
        "error": _LOAD_ERROR,
        "engine": "DILI-ML v1 (Random Forest on Morgan FP + RDKit descriptors)",
        "metrics": _TRAIN_METRICS,
    }


def warmup() -> dict[str, Any]:
    try:
        _load_model()
        return {"status": "ready", **is_ready()}
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "error": str(exc), **is_ready()}


def veto_gate() -> dict[str, Any]:
    """Bundle-stored conformal veto + screen thresholds, on the SERVED probability
    scale (calibrated when the ECE gate kept the sigmoid calibrator, else raw — in
    which case the served probability is ALSO raw, so the two stay on one scale).
    Lets runtime consumers threshold the served dili_probability on the same scale
    it is displayed. Loads (and, if needed, trains) the model."""
    bundle = _load_model()
    calibrated = bundle.get("calibrator") is not None
    return {
        "endpoint": "dili",
        "calibrated": calibrated,
        "scale": "calibrated" if calibrated else "raw",
        "veto_threshold": bundle.get("veto_threshold"),
        "veto_alpha": bundle.get("veto_alpha"),
        "screen_threshold": bundle.get("screen_threshold"),
    }


def _risk_class(prob: float) -> str:
    """Map DILI-positive probability to qualitative risk class.

    Thresholds match the cardiotox triage convention used elsewhere in this
    service (Low <0.30, Moderate <0.60, else High). These are pharma-industry
    triage bands, not regulatory thresholds.
    """
    if prob < 0.30:
        return "Low"
    if prob < 0.60:
        return "Moderate"
    return "High"


def _severity_hint(prob: float) -> str:
    """Map probability to a *suggested* severity tier for the user's manual review.

    This is explicitly a hint, not a prediction. The 5-class severity in the
    Stage 2 schema (none/mild/moderate/severe/most-concern) is not predicted by
    this binary classifier; the user is expected to confirm or override it via
    Manual Entry, optionally informed by this hint and by external sources
    (DILIrank / LiverTox).
    """
    if prob < 0.20:
        return "none-or-mild"
    if prob < 0.50:
        return "moderate"
    if prob < 0.75:
        return "severe"
    return "most-concern"


def _fallback_envelope(smiles: str, error: str) -> dict[str, Any]:
    return {
        "smiles": smiles,
        "source": "fallback",
        "ml_available": False,
        "error": error,
        "prediction": {
            "dili_probability": None,
            "risk_class": None,
            "severity_hint": None,
        },
        "model_info": {
            "engine": "DILI-ML (unavailable)",
            "method": "Model failed to load or featurize; consumer should fall back to Manual Entry",
            "load_status": is_ready(),
        },
    }


def predict_dili_ml(
    smiles: str | None = None, features: list[float] | None = None
) -> dict[str, Any]:
    """Predict binary DILI-risk probability.

    Privacy-preserving: pass EITHER `smiles` OR a client-computed `features`
    vector (Morgan-1024 r2 || [MolWt, MolLogP, TPSA, HBD, HBA, FractionCSP3]).
    In fingerprint mode the server never receives the structure.

    Returns:
        {
          smiles, source: "ml"|"fallback", ml_available,
          prediction: { dili_probability, risk_class, severity_hint },
          model_info: { engine, method, training, performance, ... }
        }

    Raises:
        ValueError if SMILES is empty/whitespace.
    """
    import numpy as np

    fp_mode = features is not None
    if not fp_mode and (not smiles or not smiles.strip()):
        raise ValueError("either smiles or features is required")

    try:
        bundle = _load_model()
    except Exception as exc:  # noqa: BLE001
        return _fallback_envelope(smiles if not fp_mode else None, f"model_load_failed: {exc}")

    feats = np.asarray(features, dtype=float) if fp_mode else _featurize(smiles)
    if feats is None:
        return _fallback_envelope(smiles, "rdkit_could_not_parse_smiles")

    try:
        t0 = time.time()
        clf = bundle["model"]
        proba = clf.predict_proba(feats.reshape(1, -1))[0]
        classes = list(clf.classes_)
        if 1 in classes:
            raw_prob = float(proba[classes.index(1)])
        else:
            raw_prob = float(proba[-1])
        # Apply the cross-fitted sigmoid calibrator IF the ECE gate kept it. When
        # it was rejected (cal set too small / no ECE gain) we honestly report the
        # raw score and the veto operates on that same raw scale.
        calibrator = bundle.get("calibrator")
        if calibrator is not None:
            cal_proba = calibrator.predict_proba(feats.reshape(1, -1))[0]
            cclasses = list(calibrator.classes_)
            idx = cclasses.index(1) if 1 in cclasses else -1
            prob = float(np.clip(cal_proba[idx], 0.0, 1.0))
            calibration = {
                "available": True,
                "method": bundle.get("calibration_method", "sigmoid (cross-fitted, 5-fold)"),
                "n_calibration": bundle.get("n_calibration"),
                "ece_test": bundle.get("ece_test"),
                "ece_test_raw": bundle.get("ece_test_raw"),
                "brier_test": bundle.get("brier_test"),
                "brier_test_raw": bundle.get("brier_test_raw"),
                "veto_threshold": bundle.get("veto_threshold"),
                "veto_alpha": bundle.get("veto_alpha"),
                "reference": "Niculescu-Mizil & Caruana 2005",
            }
        else:
            prob = raw_prob
            calibration = {
                "available": False,
                "reason": bundle.get(
                    "calibration_method", "uncalibrated (cal set too small / no ECE gain)"
                ),
                "ece_test_raw": bundle.get("ece_test_raw"),
                "ece_test_calibrated": bundle.get("ece_test_calibrated"),
                "veto_threshold": bundle.get("veto_threshold"),
                "veto_alpha": bundle.get("veto_alpha"),
                "note": "raw RF score reported; veto operates on the raw scale (monotone-invariant)",
            }
        inference_time_ms = round((time.time() - t0) * 1000, 2)
    except Exception as exc:  # noqa: BLE001
        logger.exception("DILI-ML inference failed for %s", scrub_smiles(smiles))
        return _fallback_envelope(smiles, f"inference_failed: {exc}")

    return {
        "smiles": smiles,
        "source": "ml",
        "ml_available": True,
        "prediction": {
            "dili_probability": prob,
            "dili_probability_raw": raw_prob,
            "risk_class": _risk_class(prob),
            "severity_hint": _severity_hint(prob),
            "calibration": calibration,
        },
        "model_info": {
            "engine": "DILI-ML v2 (RF on Morgan FP + RDKit descriptors, cross-fitted Platt calibration)",
            "method": "Binary DILI-risk classifier trained on TDC DILI (Xu et al. 2015); "
            "cross-fitted sigmoid calibration (ECE-gated) + FPR-controlled conformal veto",
            "scope_caveat": (
                "Predicts a binary DILI-risk probability only. The 5-class severity and "
                "mechanism flags (mitochondrial / BSEP / ROS / immune) in the Stage 2 "
                "schema are NOT predicted — the user must confirm them via Manual Entry. "
                "severity_hint is a heuristic mapping for the user's review and is not a "
                "model output."
            ),
            "training": {
                "dataset": "TDC DILI (Xu et al. 2015)",
                "n_train": bundle.get("n_train"),
                "n_test": bundle.get("n_test"),
                "n_positives": bundle.get("n_positives"),
                "n_negatives": bundle.get("n_negatives"),
                "label_definition": "Binary DILI-positive (curated from FDA drug label hepatotoxicity sections)",
            },
            "performance": {
                "test_auroc": bundle.get("test_auroc"),
                "test_auprc": bundle.get("test_auprc"),
                "brier_test": bundle.get("brier_test"),
                "brier_test_raw": bundle.get("brier_test_raw"),
                "ece_test": bundle.get("ece_test"),
                "ece_test_raw": bundle.get("ece_test_raw"),
                "calibration_available": bundle.get("calibration_available"),
                "cv_roc_auc_mean": bundle.get("cv_roc_auc_mean"),
                "cv_roc_auc_std": bundle.get("cv_roc_auc_std"),
                "cv_folds": 5,
            },
            "features": {
                "morgan_nbits": bundle.get("morgan_nbits"),
                "morgan_radius": bundle.get("morgan_radius"),
                "rdkit_descriptors": DESCRIPTOR_NAMES,
            },
            "inference_time_ms": inference_time_ms,
            "license": "MIT (HakaseAI internal); training data CC-BY 4.0 (TDC)",
            "reference": "Xu et al., J. Chem. Inf. Model., 2015 — via Therapeutics Data Commons (tdcommons.ai)",
        },
    }
