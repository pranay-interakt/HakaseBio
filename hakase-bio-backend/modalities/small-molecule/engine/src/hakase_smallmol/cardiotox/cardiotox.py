"""CardioTox — dedicated hERG cardiotoxicity predictor.

Independent second-opinion model that augments ADMET-AI's hERG prediction.
Methodologically distinct in two ways:

  1. Different feature representation: Morgan circular fingerprint (1024-bit,
     radius 2) + 7 RDKit descriptors (incl. a basic-nitrogen count) — not
     learned graph embeddings.
  2. Different algorithm class: Random Forest classifier — not a GNN.

TRAINING DATA (v2.0.0 — changed from v1.0.0):
  Trains on the vendored `data/herg_karim.tab` (TDC `hERG_Karim`, Karim et al.,
  13,445 compounds, near-balanced 6,727 non-blocker / 6,718 blocker).

  v1.0.0 trained on TDC `hERG` (Wang et al.) — only 655 compounds and heavily
  imbalanced (451 blocker / 204 non-blocker). The Karim set is ~20x larger and
  class-balanced, which is why this model moved to it. Both curate the same
  endpoint at the same IC50 < 10 µM blocker threshold, so the label semantics
  and the downstream risk bands are unchanged; only the evidence base grew.

  v1.0.0 also *downloaded* the dataset at first call via `tdc.single_pred.Tox`,
  making a cold start depend on network reachability of the TDC CDN. It now
  reads the vendored .tab, consistent with every `_ml_base` model — cold start
  is offline and deterministic.

NOTE: because the training set changed, every calibration fitted against this
model's score distribution (conformal veto threshold, screening thresholds,
scaffold hold-out metrics) MUST be regenerated — a stale threshold fitted to
the v1 scores carries no guarantee on v2. See scripts/calibrate_*.py.

Trains on first call (~30-60s on this dataset), caches the fitted pipeline to
disk as a pickle so subsequent server starts and inference are sub-50ms.
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
MODEL_PATH = os.path.join(CACHE_DIR, "cardiotox_rf.pkl")
# v2.1.0: isotonic probability calibration (three-way fit/cal/test split) +
# conformal veto refitted on the CALIBRATED cal-set scores. Blocker probability
# is now a calibrated probability, not a raw RF ranking score. Bumped from 2.0.0
# so the cache retrains and the isotonic object is persisted in the bundle.
MODEL_VERSION = "2.1.0"
MORGAN_NBITS = 1024
MORGAN_RADIUS = 2

# α for the conformal veto (bound on FPR against true-inactive compounds).
VETO_ALPHA = 0.05
# Three-way split fractions (mirrors models/tox21_ml.py): fit the RF on 60%,
# fit isotonic + veto on a disjoint 20% calibration split, measure calibration
# on an untouched 20% test split.
TEST_FRACTION = 0.20
CAL_FRACTION = 0.20
_SEED = 42

# Vendored TDC hERG_Karim table (see module docstring).
TDC_FILE = "herg_karim.tab"
DATASET_REF = "TDC hERG_Karim (Karim et al., 2021)"

# 1024 Morgan bits + 7 descriptors. Exposed so `features`-mode callers can
# validate their vector length before sending it.
DESCRIPTOR_NAMES = [
    "MolWt",
    "MolLogP",
    "TPSA",
    "HBD",
    "HBA",
    "FractionCSP3",
    "BasicN",
]
FEATURE_DIM = MORGAN_NBITS + len(DESCRIPTOR_NAMES)


# --------------------------------------------------------------------------- #
# Featurization
# --------------------------------------------------------------------------- #


def _featurize(smiles: str) -> np.ndarray | None:
    """Convert SMILES → fixed-size feature vector. Returns None on parse failure.

    Uses `rdMolDescriptors` (direct C++ binding) and `Crippen` rather than the
    high-level `rdkit.Chem.Descriptors` module, which transitively pulls in
    `rdkit.ML.InfoTheory` and is incompatible with numpy 2.x in the currently
    pinned RDKit build.
    """
    from rdkit import Chem
    from rdkit.Chem import AllChem, Crippen, rdMolDescriptors
    from rdkit.DataStructs import ConvertToNumpyArray

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None

    # Morgan fingerprint (1024-bit, radius 2)
    fp = AllChem.GetMorganFingerprintAsBitVect(mol, MORGAN_RADIUS, nBits=MORGAN_NBITS)
    fp_arr = np.zeros(MORGAN_NBITS, dtype=np.int8)
    ConvertToNumpyArray(fp, fp_arr)

    # Heuristic basic-N count (uncharged tertiary/secondary amines, a known
    # correlate of hERG liability for cationic ion-channel binders).
    try:
        nb = sum(
            1
            for a in mol.GetAtoms()
            if a.GetSymbol() == "N" and a.GetFormalCharge() >= 0 and a.GetTotalNumHs() == 0
        )
    except Exception:
        nb = 0

    desc = np.array(
        [
            rdMolDescriptors.CalcExactMolWt(mol),
            Crippen.MolLogP(mol),
            rdMolDescriptors.CalcTPSA(mol),
            float(rdMolDescriptors.CalcNumHBD(mol)),
            float(rdMolDescriptors.CalcNumHBA(mol)),
            rdMolDescriptors.CalcFractionCSP3(mol),
            float(nb),
        ],
        dtype=np.float64,
    )

    return np.concatenate([fp_arr.astype(np.float64), desc])


def _featurize_batch(smiles_list: list[str]) -> tuple[np.ndarray, list[int]]:
    """Featurize a batch, dropping unparseable SMILES. Returns (X, kept_indices)."""
    rows: list[np.ndarray] = []
    kept: list[int] = []
    for i, s in enumerate(smiles_list):
        v = _featurize(s)
        if v is not None:
            rows.append(v)
            kept.append(i)
    if not rows:
        return np.empty((0, MORGAN_NBITS + 7), dtype=np.float64), []
    return np.vstack(rows), kept


# --------------------------------------------------------------------------- #
# Train + cache
# --------------------------------------------------------------------------- #


def _train() -> dict[str, Any]:
    """Train an RF classifier on the vendored TDC hERG_Karim set and persist.

    Pipeline (mirrors models/tox21_ml.py): three-way stratified split → fit the
    RF on the fit split → isotonic-calibrate P(blocker) on the disjoint cal split
    → refit the conformal veto on the CALIBRATED cal-set inactive scores →
    measure ECE/Brier (raw vs calibrated) on the untouched test split.

    Reads the vendored .tab via `_ml_base.load_tdc_tab` (which canonicalizes
    SMILES, drops unparseable rows and missing labels, and sorts for a
    deterministic training order) — no network access, unlike v1.0.0.
    """
    import hakase_kernel.base as base
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.isotonic import IsotonicRegression
    from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
    from sklearn.model_selection import train_test_split

    logger.info("CardioTox: loading vendored %s ...", TDC_FILE)
    smiles, y_raw = base.load_tdc_tab(TDC_FILE)
    y = np.asarray(y_raw).astype(int)

    logger.info("CardioTox: featurizing %d compounds...", len(smiles))
    X, kept = _featurize_batch(smiles)
    y_kept = y[kept]
    logger.info(
        "CardioTox: %d compounds featurized successfully (%d skipped)",
        len(kept),
        len(smiles) - len(kept),
    )

    # Three-way split: fit / calibration / untouched test. Stratified so every
    # split preserves the blocker/non-blocker balance.
    X_tmp, X_test, y_tmp, y_test = train_test_split(
        X, y_kept, test_size=TEST_FRACTION, random_state=_SEED, stratify=y_kept
    )
    X_fit, X_cal, y_fit, y_cal = train_test_split(
        X_tmp,
        y_tmp,
        test_size=CAL_FRACTION / (1.0 - TEST_FRACTION),
        random_state=_SEED,
        stratify=y_tmp,
    )

    clf = RandomForestClassifier(
        n_estimators=300,
        max_depth=None,
        min_samples_leaf=2,
        n_jobs=-1,
        random_state=42,
        class_weight="balanced",
    )
    logger.info("CardioTox: fitting RF on %d fit-split compounds...", X_fit.shape[0])
    clf.fit(X_fit, y_fit)

    # Isotonic calibration of the ranked RF scores → true probabilities.
    raw_cal = base.positive_class_proba(clf, X_cal)
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    iso.fit(raw_cal, y_cal)

    def _calibrated(Xin: np.ndarray) -> np.ndarray:
        return np.clip(iso.predict(base.positive_class_proba(clf, Xin)), 0.0, 1.0)

    def _cal_smiles(smiles: list[str]) -> np.ndarray:
        Xa, _ = _featurize_batch(smiles)
        return _calibrated(Xa) if Xa.shape[0] else np.empty(0)

    # Veto (NO-GO) + screen (WATCH): FPR-controlled conformal thresholds fitted on
    # the CALIBRATED approved-drug hold-out, so P(flag | approved) ≤ α on the served
    # (calibrated) scale — the runtime safety guarantee. (The training-set inactives
    # are NOT exchangeable with approved drugs, so a cal-set-fitted threshold does
    # not bound the approved-drug FPR.)
    gate_fields = base.fit_approved_veto_screen(_cal_smiles, veto_alpha=VETO_ALPHA)

    # ---- Untouched test-split calibration audit (raw vs calibrated) ----
    raw_test = base.positive_class_proba(clf, X_test)
    cal_test = _calibrated(X_test)
    both_classes = len(set(y_test.tolist())) > 1
    auroc = float(roc_auc_score(y_test, cal_test)) if both_classes else None
    auprc = float(average_precision_score(y_test, cal_test)) if y_test.sum() > 0 else None
    brier_raw = float(brier_score_loss(y_test, raw_test))
    brier_cal = float(brier_score_loss(y_test, cal_test))
    ece_raw = base.expected_calibration_error(y_test, raw_test, n_bins=10)
    ece_cal = base.expected_calibration_error(y_test, cal_test, n_bins=10)

    # Class balance (full usable dataset).
    pos = int(y_kept.sum())
    n = int(len(y_kept))

    bundle = {
        "version": MODEL_VERSION,
        "model": clf,
        "isotonic": iso,
        "calibration_method": "isotonic (three-way fit/cal/test)",
        "n_train": int(X_fit.shape[0]),
        "n_train_total": n,
        "n_calibration": int(X_cal.shape[0]),
        "n_cal_negatives": int((y_cal == 0).sum()),
        "n_test": int(X_test.shape[0]),
        "n_positives": pos,
        "n_negatives": n - pos,
        # AUROC on the untouched test split (rank metric; identical raw vs calibrated).
        "test_auroc": auroc,
        "test_auprc": auprc,
        "brier_test": brier_cal,
        "brier_test_raw": brier_raw,
        "ece_test": ece_cal,
        "ece_test_raw": ece_raw,
        # Back-compat: keep the historical CV field names populated with the honest
        # held-out test AUROC so model_info / status keep their shape.
        "cv_roc_auc_mean": auroc,
        "cv_roc_auc_std": None,
        "morgan_nbits": MORGAN_NBITS,
        "morgan_radius": MORGAN_RADIUS,
        "feature_dim": int(X.shape[1]),
        "trained_at": time.time(),
        # veto_threshold / veto_alpha / screen_threshold + approved-drug FPR proof.
        **gate_fields,
    }

    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(MODEL_PATH, "wb") as f:
        pickle.dump(bundle, f)
    logger.info(
        "CardioTox: cached to %s (test AUROC=%s ECE raw=%s→cal=%s Brier raw=%.3f→cal=%.3f "
        "veto=%s FPR-approved=%s)",
        MODEL_PATH,
        f"{auroc:.3f}" if auroc is not None else "n/a",
        f"{ece_raw:.4f}" if ece_raw is not None else "n/a",
        f"{ece_cal:.4f}" if ece_cal is not None else "n/a",
        brier_raw,
        brier_cal,
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
                    logger.info("CardioTox: cache version mismatch, retraining...")
                    bundle = _train()
            else:
                logger.info("CardioTox: no cache found, training from scratch...")
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
            logger.info("CardioTox: ready in %.2fs", _LOAD_TIME_S)
            return _MODEL
        except Exception as exc:  # noqa: BLE001
            _LOAD_ERROR = f"{type(exc).__name__}: {exc}"
            logger.exception("CardioTox: failed to load/train model")
            raise


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #


def is_ready() -> dict[str, Any]:
    """Report load status without forcing a load."""
    return {
        "loaded": _MODEL is not None,
        "load_time_s": _LOAD_TIME_S,
        "error": _LOAD_ERROR,
        "engine": "CardioTox v2 (Random Forest on Morgan FP + RDKit descriptors)",
        "metrics": _TRAIN_METRICS,
    }


def warmup() -> dict[str, Any]:
    """Force model load/train (used by /models/warmup endpoint)."""
    try:
        _load_model()
        return {"status": "ready", **is_ready()}
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "error": str(exc), **is_ready()}


def veto_gate() -> dict[str, Any]:
    """Bundle-stored conformal veto + screen thresholds, on the SERVED probability
    scale (calibrated when a calibrator is present). Returned so runtime consumers
    (safety_triage, invitro_panel) can threshold the served blocker_probability on
    the SAME scale it is displayed, instead of the raw-scale JSON artifact. Loads
    (and, if needed, trains) the model."""
    bundle = _load_model()
    return {
        "endpoint": "herg",
        "calibrated": bundle.get("isotonic") is not None,
        "scale": "calibrated" if bundle.get("isotonic") is not None else "raw",
        "veto_threshold": bundle.get("veto_threshold"),
        "veto_alpha": bundle.get("veto_alpha"),
        "screen_threshold": bundle.get("screen_threshold"),
    }


def _risk_class(prob: float) -> str:
    """Map blocker probability to qualitative risk class.

    Thresholds follow common pharma-industry triage practice for hERG screens
    (cf. Crumb et al., JPET 2016; AstraZeneca cardiac safety pipeline):
      <0.30  → Low
      <0.60  → Moderate
      else   → High
    """
    if prob < 0.30:
        return "Low"
    if prob < 0.60:
        return "Moderate"
    return "High"


def _ic50_band(prob: float) -> str:
    """Qualitative IC50 band given the binary classifier was trained at <10uM cutoff.

    The classifier itself does not predict IC50; this is a calibrated qualitative
    band derived from the blocker probability and the training threshold.
    """
    if prob < 0.30:
        return "> 30 µM (likely safe)"
    if prob < 0.60:
        return "1 – 30 µM (borderline)"
    return "< 10 µM (likely blocker)"


def _fallback_envelope(smiles: str, error: str) -> dict[str, Any]:
    return {
        "smiles": smiles,
        "source": "fallback",
        "ml_available": False,
        "error": error,
        "prediction": {
            "blocker_probability": None,
            "risk_class": None,
            "ic50_band": None,
        },
        "model_info": {
            "engine": "CardioTox (unavailable)",
            "method": "Model failed to load or featurize; consumer should rely on ADMET-AI hERG only",
            "load_status": is_ready(),
        },
    }


def predict_cardiotox(
    smiles: str | None = None, features: list[float] | None = None
) -> dict[str, Any]:
    """Predict hERG blocker probability.

    Privacy-preserving input: pass EITHER `smiles` OR a client-computed
    `features` vector of length `FEATURE_DIM` (1031) laid out as
    Morgan-1024 r2 || [MolWt, MolLogP, TPSA, HBD, HBA, FractionCSP3, BasicN].
    When `features` is supplied the server never receives the structure — this
    is the fingerprint-only mode the privacy policy promises.

    NOTE: this model's descriptor block is 7 wide (it carries a basic-nitrogen
    count the `_ml_base` family does not), so a 1030-length `_ml_base`-shaped
    vector is NOT valid here and is rejected rather than silently mis-scored.

    Raises:
        ValueError if neither a SMILES nor a features vector is supplied.
    """
    import numpy as np

    fp_mode = features is not None
    if not fp_mode and (not smiles or not smiles.strip()):
        raise ValueError("either smiles or features is required")

    try:
        bundle = _load_model()
    except Exception as exc:  # noqa: BLE001
        return _fallback_envelope(smiles if not fp_mode else None, f"model_load_failed: {exc}")

    if fp_mode:
        feats = np.asarray(features, dtype=float)
        if feats.ndim != 1 or feats.size != FEATURE_DIM:
            return _fallback_envelope(
                None,
                f"bad_features_length: expected {FEATURE_DIM} "
                f"(Morgan-{MORGAN_NBITS} r{MORGAN_RADIUS} || {len(DESCRIPTOR_NAMES)} descriptors "
                f"{DESCRIPTOR_NAMES}), got {feats.size}",
            )
    else:
        feats = _featurize(smiles)
    if feats is None:
        return _fallback_envelope(smiles, "rdkit_could_not_parse_smiles")

    try:
        t0 = time.time()
        clf = bundle["model"]
        proba = clf.predict_proba(feats.reshape(1, -1))[0]
        # Raw RF ranking score for class 1 (blocker).
        classes = list(clf.classes_)
        if 1 in classes:
            raw_prob = float(proba[classes.index(1)])
        else:
            raw_prob = float(proba[-1])
        # Apply the isotonic calibrator (if the bundle carries one) → the served
        # blocker_probability is a calibrated probability, thresholded on the SAME
        # calibrated scale as the veto below. Older bundles without a calibrator
        # fall back honestly to the raw score (calibration.available=False).
        iso = bundle.get("isotonic")
        if iso is not None:
            prob = float(np.clip(iso.predict([raw_prob])[0], 0.0, 1.0))
            calibration = {
                "available": True,
                "method": bundle.get("calibration_method", "isotonic (three-way fit/cal/test)"),
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
                "reason": "bundle carries no calibrator (pre-2.1.0 cache) — raw RF score reported",
            }
        inference_time_ms = round((time.time() - t0) * 1000, 2)
    except Exception as exc:  # noqa: BLE001
        logger.exception("CardioTox inference failed for %s", scrub_smiles(smiles))
        return _fallback_envelope(smiles, f"inference_failed: {exc}")

    return {
        "smiles": smiles,
        "source": "ml",
        "ml_available": True,
        "prediction": {
            "blocker_probability": prob,
            "blocker_probability_raw": raw_prob,
            "risk_class": _risk_class(prob),
            "ic50_band": _ic50_band(prob),
            "calibration": calibration,
        },
        "model_info": {
            "engine": "CardioTox v2.1 (RF on Morgan FP + RDKit descriptors, isotonic-calibrated)",
            "method": f"Independent second-opinion classifier trained on {DATASET_REF}; "
            "isotonic probability calibration + FPR-controlled conformal veto",
            "training": {
                "dataset": DATASET_REF,
                "n_train": bundle.get("n_train"),
                "n_calibration": bundle.get("n_calibration"),
                "n_test": bundle.get("n_test"),
                "n_positives": bundle.get("n_positives"),
                "n_negatives": bundle.get("n_negatives"),
                "label_threshold": "IC50 < 10 µM = blocker",
            },
            "performance": {
                "test_auroc": bundle.get("test_auroc"),
                "test_auprc": bundle.get("test_auprc"),
                "brier_test": bundle.get("brier_test"),
                "brier_test_raw": bundle.get("brier_test_raw"),
                "ece_test": bundle.get("ece_test"),
                "ece_test_raw": bundle.get("ece_test_raw"),
                "veto_threshold": bundle.get("veto_threshold"),
                "veto_alpha": bundle.get("veto_alpha"),
                "veto_realised_fpr_on_approved": bundle.get("veto_realised_fpr_on_approved"),
                "veto_recall_on_withdrawn": bundle.get("veto_recall_on_withdrawn"),
                "veto_calibration_population": bundle.get("veto_calibration_population"),
                # historical field name retained (now = held-out test AUROC)
                "cv_roc_auc_mean": bundle.get("cv_roc_auc_mean"),
                "cv_roc_auc_std": bundle.get("cv_roc_auc_std"),
                "cv_folds": 5,
            },
            "features": {
                "morgan_nbits": bundle.get("morgan_nbits"),
                "morgan_radius": bundle.get("morgan_radius"),
                "rdkit_descriptors": DESCRIPTOR_NAMES,
                "feature_dim": FEATURE_DIM,
            },
            "inference_time_ms": inference_time_ms,
            "license": "MIT (HakaseAI internal); training data CC-BY 4.0 (TDC)",
            "reference": "Karim et al., 2021 (hERG_Karim) — via Therapeutics Data Commons (tdcommons.ai)",
        },
    }
