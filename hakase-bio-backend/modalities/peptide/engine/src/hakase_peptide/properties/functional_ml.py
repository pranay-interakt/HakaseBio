"""Structured Functional Predictors (Functional Analysis Service Spec §5.3, §6.4).

Gradient-boosted tree ensembles (XGBoost) over a feature vector that combines:
  - the same 26-feature biochemical descriptor block already used and
    validated in ``properties/esm_ml.py`` (amino-acid composition, net
    charge, GRAVY, hydrophobic moment, etc.), and
  - 8 scalar descriptors **actually read from the Physicochemical Evidence
    Object** (molecular weight, isoelectric point, GRAVY, hydrophobic moment,
    instability index, aliphatic index, aromaticity, Boman index) — this is
    what §5.3 means by "structured features derived from physicochemical...
    evidence": real upstream evidence values, not a re-derivation from the
    raw sequence.

Applicability-domain checking (§10.2): each trained model stores its
training-feature mean/std; at inference, any input whose feature vector
lands >3 standard deviations from the training distribution on any feature
is flagged ``applicability_domain: "out_of_domain"`` and its confidence tier
is forced down regardless of the model's raw output score, per §10.2's
explicit requirement ("flagged as reduced confidence regardless of the
model's raw output score").

Endpoint coverage is honest, not aspirational: only endpoints with a real
curated dataset in this codebase are served. ``receptor_binding_propensity``
and ``enzyme_inhibition_propensity`` have no training data here yet -- they
report ``unavailable`` with reason ``no_training_data`` rather than a
fabricated score (§12), and are documented extension points.
"""

from __future__ import annotations

import logging
import os
import pickle
import threading
from typing import Any

import numpy as np
from hakase_kernel.runtime.paths import cache_dir
from hakase_sequence.descriptors import extract_features as _seq_features

from ..domain.peptide import Peptide
from .esm_ml import (
    _AMP_NEG,
    _AMP_POS,
    _CPP_NEG,
    _CPP_POS,
    _HEMO_NEG,
    _HEMO_POS,
    _clean,
)

logger = logging.getLogger(__name__)

CACHE_DIR = str(cache_dir())
MODEL_PATH = os.path.join(CACHE_DIR, "functional_structured_ml_v2.pkl")
MODEL_VERSION = (
    "2.0.0"  # bumped from 1.0.0: feature vector now includes physicochemical descriptors
)

# endpoint name -> (positives, negatives) ; only endpoints with real curated data.
_DATASETS: dict[str, tuple[list[str], list[str]]] = {
    "antimicrobial_activity": (_AMP_POS, _AMP_NEG),
    "cell_penetration_activity": (_CPP_POS, _CPP_NEG),
    "hemolytic_liability": (_HEMO_POS, _HEMO_NEG),
}
SUPPORTED_ENDPOINTS: tuple[str, ...] = tuple(_DATASETS.keys())

# endpoints the Workflow Selector (M1) can request that have no data yet.
UNSUPPORTED_ENDPOINTS: tuple[str, ...] = (
    "receptor_binding_propensity",
    "enzyme_inhibition_propensity",
)

# The 8 scalar physicochemical descriptors this module reads from the
# Physicochemical Evidence Object, in a fixed order, matching the raw keys
# services/physicochemical.py itself reads off `phys` before wrapping them
# into the evidence descriptor dict.
_PC_KEYS = (
    "molecular_weight_avg_da",
    "isoelectric_point",
    "gravy",
    "hydrophobic_moment",
    "instability_index",
    "aliphatic_index",
    "aromaticity",
    "boman_index",
)

_AD_ZSCORE_THRESHOLD = 3.0  # §10.2: flag out-of-applicability-domain inputs

_MODELS: dict[str, Any] | None = None
_LOAD_LOCK = threading.Lock()


def _pc_features_from_raw(phys: dict[str, Any]) -> np.ndarray:
    """8-dim vector straight from properties_for()'s raw physicochemical dict
    (training-time path -- exact same computation the Physicochemical Service
    itself performs, before it gets wrapped into evidence descriptor blocks).
    """
    return np.array([float(phys.get(k) or 0.0) for k in _PC_KEYS], dtype=np.float64)


def _pc_features_from_evidence(descriptors: dict[str, Any] | None) -> np.ndarray:
    """8-dim vector read from an already-assembled Physicochemical Evidence
    Object's ``descriptors`` block (inference-time path -- real upstream
    evidence, per §5.3, not a re-derivation from the sequence).
    """
    if not descriptors:
        return np.zeros(len(_PC_KEYS), dtype=np.float64)
    key_map = {
        "molecular_weight_avg_da": ("molecular_weight", "value"),
        "isoelectric_point": ("isoelectric_point", "value"),
        "gravy": ("gravy_score", "value"),
        "hydrophobic_moment": ("hydrophobic_moment", "value"),
        "instability_index": ("instability_index", "value"),
        "aliphatic_index": ("aliphatic_index", "value"),
        "aromaticity": ("aromaticity", "value"),
        "boman_index": ("boman_index", "value"),
    }
    out = []
    for pc_key in _PC_KEYS:
        block_key, field = key_map[pc_key]
        block = descriptors.get(block_key) or {}
        out.append(float(block.get(field) or 0.0))
    return np.array(out, dtype=np.float64)


def _full_features_for_training(sequence: str) -> np.ndarray:
    """26 sequence-derived features + 8 real physicochemical-evidence-derived
    features, computed the same way the Physicochemical Service computes them
    (via ``properties_for``), so training and inference read the same
    underlying biochemistry.
    """
    from ..services.compute import properties_for

    seq = _clean(sequence)
    base = _seq_features(seq)
    pep = Peptide.create(seq)
    phys = properties_for(pep).get("physicochemical", {})
    pc = _pc_features_from_raw(phys)
    return np.concatenate([base, pc])


def _build_dataset(positives: list[str], negatives: list[str]) -> tuple[np.ndarray, np.ndarray]:
    X = np.stack([_full_features_for_training(s) for s in positives + negatives])
    y = np.concatenate([np.ones(len(positives)), np.zeros(len(negatives))])
    return X, y


def _train_classifiers() -> dict[str, Any]:
    from sklearn.model_selection import cross_val_score
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler
    from xgboost import XGBClassifier

    results: dict[str, Any] = {"version": MODEL_VERSION}
    for name, (pos, neg) in _DATASETS.items():
        X, y = _build_dataset(pos, neg)
        clf = Pipeline(
            [
                ("scaler", StandardScaler()),
                (
                    "xgb",
                    XGBClassifier(
                        n_estimators=150,
                        max_depth=3,
                        learning_rate=0.08,
                        subsample=0.8,
                        colsample_bytree=0.8,
                        eval_metric="logloss",
                        random_state=42,
                        n_jobs=1,
                    ),
                ),
            ]
        )
        try:
            cv_scores = cross_val_score(
                clf, X, y, cv=min(5, min(int(sum(y)), len(y) - int(sum(y)))), scoring="roc_auc"
            )
            cv_auc = float(np.mean(cv_scores))
        except Exception:
            cv_auc = float("nan")

        clf.fit(X, y)
        results[name] = {
            "clf": clf,
            "cv_auc": cv_auc,
            "n_pos": int(sum(y)),
            "n_neg": int(len(y) - sum(y)),
            # §10.2 applicability domain: training feature distribution, used
            # at inference to flag out-of-domain inputs regardless of the
            # model's raw output score.
            "feature_mean": X.mean(axis=0),
            "feature_std": X.std(axis=0) + 1e-6,
        }
        logger.info(
            "functional_ml: %s trained (xgboost, %d features incl. physicochemical) — "
            "n=%d, cv_auc=%.3f",
            name,
            X.shape[1],
            len(y),
            cv_auc,
        )
    return results


def _load_models() -> dict[str, Any]:
    global _MODELS
    if _MODELS is not None:
        return _MODELS
    with _LOAD_LOCK:
        if _MODELS is not None:
            return _MODELS
        if os.path.exists(MODEL_PATH):
            with open(MODEL_PATH, "rb") as f:
                cached = pickle.load(f)
            if cached.get("version") == MODEL_VERSION:
                _MODELS = cached
                return _MODELS
            logger.info(
                "functional_ml: cache stale (version bumped to %s) — retraining", MODEL_VERSION
            )
        _MODELS = _train_classifiers()
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(MODEL_PATH, "wb") as f:
            pickle.dump(_MODELS, f)
        return _MODELS


def is_ready() -> bool:
    return _MODELS is not None


def warmup() -> None:
    try:
        _load_models()
    except Exception:
        logger.exception("functional_ml: warmup failed (non-fatal, will retry on first request)")


def _tier_for(cv_auc: float) -> str:
    if cv_auc != cv_auc:  # NaN
        return "unavailable"
    if cv_auc >= 0.85:
        return "high"
    if cv_auc >= 0.65:
        return "moderate"
    return "low"


def _applicability_domain(feats: np.ndarray, mean: np.ndarray, std: np.ndarray) -> dict[str, Any]:
    z = np.abs((feats - mean) / std)
    max_z = float(np.max(z))
    return {
        "status": "in_domain" if max_z <= _AD_ZSCORE_THRESHOLD else "out_of_domain",
        "max_feature_zscore": round(max_z, 2),
        "threshold": _AD_ZSCORE_THRESHOLD,
    }


def predict_functional_structured(
    sequence: str,
    *,
    endpoints: list[str],
    physicochemical_descriptors: dict[str, Any] | None = None,
) -> dict[str, dict[str, Any]]:
    """Predict every requested endpoint. Unsupported endpoints get an explicit
    ``unavailable`` entry, never a fabricated score.

    ``physicochemical_descriptors`` should be the Physicochemical Evidence
    Object's ``descriptors`` block (§5.3: real upstream evidence, not a
    sequence re-derivation). If omitted (e.g. a caller without an
    ExecutionContext), those 8 features fall back to zeros and the applicability
    -domain check is likely to flag the input, which is the honest outcome --
    not a fabricated confident score.
    """
    out: dict[str, dict[str, Any]] = {}
    seq = _clean(sequence)
    if len(seq) < 3:
        for ep in endpoints:
            out[ep] = {"status": "unavailable", "value": None, "reason_code": "sequence_too_short"}
        return out

    supported = [ep for ep in endpoints if ep in SUPPORTED_ENDPOINTS]
    if supported:
        try:
            models = _load_models()
            base = _seq_features(seq)
            pc = _pc_features_from_evidence(physicochemical_descriptors)
            feats = np.concatenate([base, pc]).reshape(1, -1)
        except Exception as exc:  # noqa: BLE001
            for ep in supported:
                out[ep] = {
                    "status": "unavailable",
                    "value": None,
                    "reason_code": f"model_load_failed:{exc}",
                }
            supported = []

        for ep in supported:
            m = models[ep]
            clf = m["clf"]
            prob = float(clf.predict_proba(feats)[0][1])
            ad = _applicability_domain(feats[0], m["feature_mean"], m["feature_std"])
            tier = _tier_for(m["cv_auc"])
            if ad["status"] == "out_of_domain":
                # §10.2: forced down regardless of raw output score.
                tier = "low"
            out[ep] = {
                "status": "complete",
                "value": round(prob, 4),
                "confidence": {"tier": tier, "score": round(prob, 4)},
                "applicability_domain": ad,
                "model_identifier": f"functional_ml.xgboost.{ep}",
                "model_version": MODEL_VERSION,
                "training_cv_auc": None if m["cv_auc"] != m["cv_auc"] else round(m["cv_auc"], 3),
                "n_training_positive": m["n_pos"],
                "n_training_negative": m["n_neg"],
                "used_physicochemical_evidence": physicochemical_descriptors is not None,
            }

    for ep in endpoints:
        if ep not in SUPPORTED_ENDPOINTS:
            out[ep] = {
                "status": "unavailable",
                "value": None,
                "reason_code": "no_training_data",
                "message": (
                    f"No curated training dataset exists in this codebase for "
                    f"'{ep}' yet; see properties/functional_ml.py's "
                    f"UNSUPPORTED_ENDPOINTS."
                ),
            }
    return out
