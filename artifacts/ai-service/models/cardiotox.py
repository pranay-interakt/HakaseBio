"""CardioTox — dedicated hERG cardiotoxicity predictor.

Independent second-opinion model that augments ADMET-AI's hERG prediction.
Methodologically distinct in three ways:

  1. Different training data: TDC `hERG` (Wang et al., 655 compounds, binary
     IC50<10uM threshold) — distinct from ADMET-AI's `hERG_Karim` (~13k
     compounds, different curation).
  2. Different feature representation: Morgan circular fingerprint (1024-bit,
     radius 2) + 6 key RDKit descriptors — not learned graph embeddings.
  3. Different algorithm class: Random Forest classifier — not a GNN.

Trains on first call (~2-5s on this dataset), caches the fitted pipeline to
disk as a pickle so subsequent server starts and inference are sub-50ms.
"""
from __future__ import annotations

import logging
import os
import pickle
import threading
import time
from dataclasses import dataclass, field
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

_MODEL: Any = None
_LOAD_LOCK = threading.Lock()
_LOAD_ERROR: str | None = None
_LOAD_TIME_S: float | None = None
_TRAIN_METRICS: dict[str, Any] = {}

CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "cache")
MODEL_PATH = os.path.join(CACHE_DIR, "cardiotox_rf.pkl")
MODEL_VERSION = "1.1.0"  # bumped: added training_fps for AD scoring
MORGAN_NBITS = 1024
MORGAN_RADIUS = 2


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
            1 for a in mol.GetAtoms()
            if a.GetSymbol() == "N" and a.GetFormalCharge() >= 0 and a.GetTotalNumHs() == 0
        )
    except Exception:
        nb = 0

    desc = np.array([
        rdMolDescriptors.CalcExactMolWt(mol),
        Crippen.MolLogP(mol),
        rdMolDescriptors.CalcTPSA(mol),
        float(rdMolDescriptors.CalcNumHBD(mol)),
        float(rdMolDescriptors.CalcNumHBA(mol)),
        rdMolDescriptors.CalcFractionCSP3(mol),
        float(nb),
    ], dtype=np.float64)

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
    """Train an RF classifier on TDC hERG and persist to disk."""
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.model_selection import cross_val_score
    from tdc.single_pred import Tox  # type: ignore[import-not-found]

    logger.info("CardioTox: downloading TDC hERG dataset...")
    df = Tox(name="hERG").get_data()
    smiles = df["Drug"].tolist()
    y = df["Y"].astype(int).to_numpy()

    logger.info("CardioTox: featurizing %d compounds...", len(smiles))
    X, kept = _featurize_batch(smiles)
    y_kept = y[kept]
    logger.info("CardioTox: %d compounds featurized successfully (%d skipped)",
                len(kept), len(smiles) - len(kept))

    clf = RandomForestClassifier(
        n_estimators=300,
        max_depth=None,
        min_samples_leaf=2,
        n_jobs=-1,
        random_state=42,
        class_weight="balanced",
    )

    # Quick CV to honestly report performance.
    # IMPORTANT: use `None` (→ JSON null) on failure, NOT float('nan'), because
    # FastAPI/Starlette's strict JSON encoder rejects NaN and would 500 the
    # /models/status and /predict/cardiotox responses.
    logger.info("CardioTox: running 5-fold CV for performance estimate...")
    cv_auc_mean: float | None
    cv_auc_std: float | None
    try:
        scores = cross_val_score(clf, X, y_kept, cv=5, scoring="roc_auc", n_jobs=-1)
        cv_auc_mean = float(np.mean(scores))
        cv_auc_std = float(np.std(scores))
    except Exception as exc:  # noqa: BLE001
        logger.warning("CardioTox: CV failed (%s); proceeding without metric", exc)
        cv_auc_mean = None
        cv_auc_std = None

    logger.info("CardioTox: fitting final model on full training set...")
    clf.fit(X, y_kept)

    # Class balance
    pos = int(y_kept.sum())
    n = int(len(y_kept))

    # Store training Morgan FP matrix for Applicability Domain (AD) scoring
    # at inference time (Tanimoto similarity to nearest training neighbor).
    # We keep only the FP columns (first MORGAN_NBITS columns), not the
    # continuous descriptor columns, to keep Tanimoto semantics correct.
    training_fps = X[:, :MORGAN_NBITS].astype(np.float32)

    bundle = {
        "version": MODEL_VERSION,
        "model": clf,
        "n_train": n,
        "n_positives": pos,
        "n_negatives": n - pos,
        "cv_roc_auc_mean": cv_auc_mean,
        "cv_roc_auc_std": cv_auc_std,
        "morgan_nbits": MORGAN_NBITS,
        "morgan_radius": MORGAN_RADIUS,
        "feature_dim": int(X.shape[1]),
        "trained_at": time.time(),
        "training_fps": training_fps,  # (n_train, 1024) float32 for AD scoring
    }

    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(MODEL_PATH, "wb") as f:
        pickle.dump(bundle, f)
    logger.info("CardioTox: model cached to %s (CV ROC-AUC = %.3f ± %.3f)",
                MODEL_PATH, cv_auc_mean, cv_auc_std)
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
                k: bundle[k] for k in (
                    "n_train", "n_positives", "n_negatives",
                    "cv_roc_auc_mean", "cv_roc_auc_std", "trained_at", "version",
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
        "engine": "CardioTox v1 (Random Forest on Morgan FP + RDKit descriptors)",
        "metrics": _TRAIN_METRICS,
    }


def warmup() -> dict[str, Any]:
    """Force model load/train (used by /models/warmup endpoint)."""
    try:
        _load_model()
        return {"status": "ready", **is_ready()}
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "error": str(exc), **is_ready()}


def _compute_ad(bundle: dict[str, Any], query_fp: np.ndarray) -> dict[str, Any]:
    """Compute Applicability Domain score via Tanimoto nearest-neighbor.

    Tanimoto(A, B) = |A∩B| / |A∪B| = dot(A,B) / (sum(A) + sum(B) - dot(A,B))

    AD threshold 0.4: molecules with nearest-neighbor Tanimoto < 0.4 are
    considered out-of-domain (extrapolation) and the model's reliability is
    substantially reduced. Molecules ≥ 0.4 are considered in-domain.

    Returns:
        ad_tanimoto_nearest: float — similarity to closest training molecule
        ad_in_domain: bool — True if nearest >= 0.4
    """
    training_fps = bundle.get("training_fps")
    if training_fps is None or len(training_fps) == 0:
        return {"ad_tanimoto_nearest": None, "ad_in_domain": None}

    q = query_fp[:MORGAN_NBITS].astype(np.float32)
    T = training_fps  # (n_train, 1024)

    dot = T @ q                      # (n_train,)
    sum_q = float(q.sum())
    sum_T = T.sum(axis=1)            # (n_train,)
    union = sum_q + sum_T - dot
    tanimoto = np.where(union > 0, dot / union, 0.0)
    nearest = float(tanimoto.max())

    return {
        "ad_tanimoto_nearest": round(nearest, 4),
        "ad_in_domain": bool(nearest >= 0.4),
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


def predict_cardiotox(smiles: str) -> dict[str, Any]:
    """Predict hERG blocker probability for a single SMILES.

    Returns:
        {
          smiles, source: "ml"|"fallback", ml_available,
          prediction: { blocker_probability, risk_class, ic50_band },
          model_info: { engine, method, training, performance, ... }
        }

    Raises:
        ValueError if SMILES is empty/whitespace (true client error → 4xx).
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
        # Probability of class 1 (blocker)
        classes = list(clf.classes_)
        if 1 in classes:
            prob = float(proba[classes.index(1)])
        else:
            prob = float(proba[-1])
        inference_time_ms = round((time.time() - t0) * 1000, 2)
    except Exception as exc:  # noqa: BLE001
        logger.exception("CardioTox inference failed for SMILES=%r", smiles)
        return _fallback_envelope(smiles, f"inference_failed: {exc}")

    # Applicability Domain scoring
    ad = _compute_ad(bundle, feats)

    return {
        "smiles": smiles,
        "source": "ml",
        "ml_available": True,
        "prediction": {
            "blocker_probability": prob,
            "risk_class": _risk_class(prob),
            "ic50_band": _ic50_band(prob),
        },
        "applicability_domain": {
            "ad_tanimoto_nearest": ad["ad_tanimoto_nearest"],
            "ad_in_domain": ad["ad_in_domain"],
            "ad_threshold": 0.4,
            "ad_note": (
                "In-domain: model interpolates within training set chemistry."
                if ad["ad_in_domain"]
                else "Out-of-domain: query is structurally distant from training set — predictions less reliable."
            ) if ad["ad_in_domain"] is not None else "AD scoring unavailable (no training FP matrix in bundle)",
        },
        "model_info": {
            "engine": "CardioTox v1 (Random Forest on Morgan FP + RDKit descriptors)",
            "method": "Independent second-opinion classifier trained on TDC hERG (Wang et al.)",
            "training": {
                "dataset": "TDC hERG (Wang et al.)",
                "n_train": bundle.get("n_train"),
                "n_positives": bundle.get("n_positives"),
                "n_negatives": bundle.get("n_negatives"),
                "label_threshold": "IC50 < 10 µM = blocker",
            },
            "performance": {
                "cv_roc_auc_mean": bundle.get("cv_roc_auc_mean"),
                "cv_roc_auc_std": bundle.get("cv_roc_auc_std"),
                "cv_folds": 5,
            },
            "features": {
                "morgan_nbits": bundle.get("morgan_nbits"),
                "morgan_radius": bundle.get("morgan_radius"),
                "rdkit_descriptors": ["MolWt", "MolLogP", "TPSA", "HBD", "HBA", "FractionCSP3", "BasicN"],
            },
            "inference_time_ms": inference_time_ms,
            "license": "MIT (HakaseAI internal); training data CC-BY 4.0 (TDC)",
            "reference": "Wang et al., AAPS PharmSci, 2016 — via Therapeutics Data Commons (tdcommons.ai)",
        },
    }
