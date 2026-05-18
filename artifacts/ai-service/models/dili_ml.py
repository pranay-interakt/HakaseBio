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

logger = logging.getLogger(__name__)

_MODEL: Any = None
_LOAD_LOCK = threading.Lock()
_LOAD_ERROR: str | None = None
_LOAD_TIME_S: float | None = None
_TRAIN_METRICS: dict[str, Any] = {}

CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "cache")
MODEL_PATH = os.path.join(CACHE_DIR, "dili_ml_rf.pkl")
MODEL_VERSION = "1.1.0"  # bumped: added training_fps for AD scoring
MORGAN_NBITS = 1024
MORGAN_RADIUS = 2
DESCRIPTOR_NAMES = ["MolWt", "MolLogP", "TPSA", "HBD", "HBA", "FractionCSP3"]
FEATURE_DIM = MORGAN_NBITS + len(DESCRIPTOR_NAMES)


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

    desc = np.array([
        rdMolDescriptors.CalcExactMolWt(mol),
        Crippen.MolLogP(mol),
        rdMolDescriptors.CalcTPSA(mol),
        float(rdMolDescriptors.CalcNumHBD(mol)),
        float(rdMolDescriptors.CalcNumHBA(mol)),
        rdMolDescriptors.CalcFractionCSP3(mol),
    ], dtype=np.float64)

    return np.concatenate([fp_arr.astype(np.float64), desc])


# --------------------------------------------------------------------------- #
# Train + cache
# --------------------------------------------------------------------------- #

def _train() -> dict[str, Any]:
    """Train an RF classifier on TDC DILI and persist to disk."""
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.model_selection import cross_val_score
    from tdc.single_pred import Tox  # type: ignore[import-not-found]

    logger.info("DILI-ML: downloading TDC DILI dataset (Xu et al. 2015)...")
    df = Tox(name="DILI").get_data()
    smiles = df["Drug"].tolist()
    y = df["Y"].astype(int).to_numpy()

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
            "(need >=50). TDC dataset may be corrupted or RDKit failed."
        )

    X = np.vstack(X_rows)
    y_arr = np.array(y_kept, dtype=int)
    n_pos = int((y_arr == 1).sum())
    n_neg = int((y_arr == 0).sum())
    logger.info(
        "DILI-ML: training RF on %d compounds (%d positive, %d negative)...",
        len(y_arr), n_pos, n_neg,
    )

    clf = RandomForestClassifier(
        n_estimators=400,
        max_depth=None,
        min_samples_leaf=2,
        n_jobs=-1,
        class_weight="balanced",
        random_state=42,
    )

    cv_auc_mean: float | None = None
    cv_auc_std: float | None = None
    try:
        scores = cross_val_score(clf, X, y_arr, cv=5, scoring="roc_auc", n_jobs=-1)
        cv_auc_mean = float(scores.mean())
        cv_auc_std = float(scores.std())
        logger.info(
            "DILI-ML: 5-fold CV ROC-AUC = %.3f ± %.3f", cv_auc_mean, cv_auc_std,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("DILI-ML: CV scoring failed (%s); proceeding with full-data fit only", exc)

    clf.fit(X, y_arr)

    # Store training Morgan FP matrix for Applicability Domain (AD) scoring
    training_fps = X[:, :MORGAN_NBITS].astype(np.float32)

    bundle: dict[str, Any] = {
        "version": MODEL_VERSION,
        "model": clf,
        "n_train": int(len(y_arr)),
        "n_positives": n_pos,
        "n_negatives": n_neg,
        "cv_roc_auc_mean": cv_auc_mean,
        "cv_roc_auc_std": cv_auc_std,
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "morgan_nbits": MORGAN_NBITS,
        "morgan_radius": MORGAN_RADIUS,
        "training_fps": training_fps,  # (n_train, 1024) float32 for AD scoring
    }

    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(MODEL_PATH, "wb") as f:
        pickle.dump(bundle, f)
    logger.info("DILI-ML: cached model to %s", MODEL_PATH)
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
                k: bundle[k] for k in (
                    "n_train", "n_positives", "n_negatives",
                    "cv_roc_auc_mean", "cv_roc_auc_std", "trained_at", "version",
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


def _compute_ad(bundle: dict[str, Any], query_fp: np.ndarray) -> dict[str, Any]:
    """Applicability Domain via Tanimoto nearest-neighbor (same logic as cardiotox)."""
    training_fps = bundle.get("training_fps")
    if training_fps is None or len(training_fps) == 0:
        return {"ad_tanimoto_nearest": None, "ad_in_domain": None}
    q = query_fp[:MORGAN_NBITS].astype(np.float32)
    T = training_fps
    dot = T @ q
    sum_q = float(q.sum())
    sum_T = T.sum(axis=1)
    union = sum_q + sum_T - dot
    tanimoto = np.where(union > 0, dot / union, 0.0)
    nearest = float(tanimoto.max())
    return {"ad_tanimoto_nearest": round(nearest, 4), "ad_in_domain": bool(nearest >= 0.4)}


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


def predict_dili_ml(smiles: str) -> dict[str, Any]:
    """Predict binary DILI-risk probability for a single SMILES.

    Returns:
        {
          smiles, source: "ml"|"fallback", ml_available,
          prediction: { dili_probability, risk_class, severity_hint },
          model_info: { engine, method, training, performance, ... }
        }

    Raises:
        ValueError if SMILES is empty/whitespace.
    """
    if not smiles or not smiles.strip():
        raise ValueError("smiles is required")

    try:
        bundle = _load_model()
    except Exception as exc:  # noqa: BLE001
        return _fallback_envelope(smiles, f"model_load_failed: {exc}")

    feats = _featurize(smiles)
    if feats is None:
        return _fallback_envelope(smiles, "rdkit_could_not_parse_smiles")

    try:
        t0 = time.time()
        clf = bundle["model"]
        proba = clf.predict_proba(feats.reshape(1, -1))[0]
        classes = list(clf.classes_)
        if 1 in classes:
            prob = float(proba[classes.index(1)])
        else:
            prob = float(proba[-1])
        inference_time_ms = round((time.time() - t0) * 1000, 2)
    except Exception as exc:  # noqa: BLE001
        logger.exception("DILI-ML inference failed for SMILES=%r", smiles)
        return _fallback_envelope(smiles, f"inference_failed: {exc}")

    ad = _compute_ad(bundle, feats)

    return {
        "smiles": smiles,
        "source": "ml",
        "ml_available": True,
        "prediction": {
            "dili_probability": prob,
            "risk_class": _risk_class(prob),
            "severity_hint": _severity_hint(prob),
        },
        "applicability_domain": {
            "ad_tanimoto_nearest": ad["ad_tanimoto_nearest"],
            "ad_in_domain": ad["ad_in_domain"],
            "ad_threshold": 0.4,
            "ad_note": (
                "In-domain: model interpolates within DILI training set chemistry."
                if ad["ad_in_domain"]
                else "Out-of-domain: query is structurally distant from training set — DILI prediction less reliable."
            ) if ad["ad_in_domain"] is not None else "AD scoring unavailable",
        },
        "model_info": {
            "engine": "DILI-ML v1 (Random Forest on Morgan FP + RDKit descriptors)",
            "method": "Binary DILI-risk classifier trained on TDC DILI (Xu et al. 2015)",
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
                "n_positives": bundle.get("n_positives"),
                "n_negatives": bundle.get("n_negatives"),
                "label_definition": "Binary DILI-positive (curated from FDA drug label hepatotoxicity sections)",
            },
            "performance": {
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
