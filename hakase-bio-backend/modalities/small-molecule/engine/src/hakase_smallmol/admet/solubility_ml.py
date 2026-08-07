"""SolubilityML — dedicated aqueous solubility (logS) predictor.

Independent ML second-opinion that augments the rule-based ESOL formula.
Methodologically distinct in three ways:

  1. Different training data: the vendored `data/solubility_aqsoldb.tab`
     (TDC `Solubility_AqSolDB`, Sorkun et al., Sci. Data 2019) — 9,982
     compounds with curated measured aqueous logS — no overlap with the
     closed-form ESOL coefficients.
  2. Different feature representation: Morgan circular fingerprint
     (1024-bit, radius 2) + 9 RDKit physicochemical descriptors —
     not a 4-term linear regression on logP/MW/RB/AP.
  3. Different algorithm class: Random Forest Regressor — non-linear
     ensemble, captures interactions invisible to a 4-term LR.

TRAINING DATA (v2.0.0 — changed from v1.0.0):
  v1.0.0 trained on `solubility_ml_data.py`: a hand-maintained Python list of
  ~120 (SMILES, logS) tuples. That set was small enough to be dominated by a
  handful of chemotypes, and its applicability domain covered a thin slice of
  drug-like space. AqSolDB is ~80x larger and spans a far wider chemical range,
  at the same endpoint and the same units (logS, log10 mol/L), so the coarse
  class cutoffs below are unchanged.

  `solubility_ml_data.py` is no longer imported by this module. It is left in
  the tree as a small, human-auditable spot-check set (its ~120 entries are
  literature values with per-row source notes), but it is NOT the training
  corpus and nothing trains on it. Note its compounds are largely a subset of
  AqSolDB chemistry, so it is not a clean hold-out either — do not report
  metrics measured on it as generalization.

NOTE: the training set changed, so the solubility conformal interval MUST be
recalibrated (scripts/calibrate_regression_conformal.py) — an interval fitted
to the v1 residuals carries no coverage guarantee on v2.

Trains on first call (~60-90s on this dataset), caches the fitted model
to disk so subsequent server starts and inference are sub-50ms.

Output is a continuous logS value plus a coarse 4-class label suitable
for the paired-view UI badge:

  logS > -2  → Highly soluble
  logS > -4  → Soluble
  logS > -6  → Slightly soluble
  else       → Insoluble

Cutoffs follow common pharma triage practice (cf. Lipinski 1997 rule of
solubility, FDA Biopharmaceutics Classification System guidance).
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
MODEL_PATH = os.path.join(CACHE_DIR, "solubility_rf.pkl")
# 2.1.0 — bundle now carries `training_fps` so the endpoint can report an
# applicability domain (see _train); forces a one-time retrain on upgrade.
MODEL_VERSION = "2.1.0"
MORGAN_NBITS = 1024
MORGAN_RADIUS = 2

# Descriptor block appended after the Morgan bits, in _featurize order. Named
# here so SHAP attributions label them instead of falling back to "feature #N".
DESCRIPTOR_NAMES = [
    "MolWt",
    "MolLogP",
    "TPSA",
    "HBD",
    "HBA",
    "NumRotatableBonds",
    "NumAromaticRings",
    "AromaticProportion",
    "FractionCSP3",
]

# Vendored TDC Solubility_AqSolDB table (see module docstring).
TDC_FILE = "solubility_aqsoldb.tab"
DATASET_REF = "TDC Solubility_AqSolDB (Sorkun et al., Sci. Data, 2019)"

# Solubility class cutoffs (logS in mol/L)
_HIGHLY_SOLUBLE = -2.0
_SOLUBLE = -4.0
_SLIGHTLY_SOLUBLE = -6.0


# --------------------------------------------------------------------------- #
# Featurization
# --------------------------------------------------------------------------- #


def _featurize(smiles: str) -> np.ndarray | None:
    """Convert SMILES → fixed-size feature vector. Returns None on parse failure.

    Uses `rdMolDescriptors` (direct C++ binding) and `Crippen` rather than the
    high-level `rdkit.Chem.Descriptors` module, which transitively pulls in
    `rdkit.ML.InfoTheory` and is incompatible with numpy 2.x in the currently
    pinned RDKit build (same workaround as cardiotox.py).
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

    # Aromatic-atom proportion (key Delaney term — also relevant for ML).
    try:
        n_heavy = mol.GetNumHeavyAtoms()
        n_aromatic = sum(1 for a in mol.GetAtoms() if a.GetIsAromatic())
        ap = (n_aromatic / n_heavy) if n_heavy > 0 else 0.0
    except Exception:
        ap = 0.0

    desc = np.array(
        [
            rdMolDescriptors.CalcExactMolWt(mol),
            Crippen.MolLogP(mol),
            rdMolDescriptors.CalcTPSA(mol),
            float(rdMolDescriptors.CalcNumHBD(mol)),
            float(rdMolDescriptors.CalcNumHBA(mol)),
            float(rdMolDescriptors.CalcNumRotatableBonds(mol)),
            float(rdMolDescriptors.CalcNumAromaticRings(mol)),
            float(ap),
            rdMolDescriptors.CalcFractionCSP3(mol),
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
        return np.empty((0, MORGAN_NBITS + 9), dtype=np.float64), []
    return np.vstack(rows), kept


# --------------------------------------------------------------------------- #
# Train + cache
# --------------------------------------------------------------------------- #


def _train() -> dict[str, Any]:
    """Train an RF regressor on the vendored AqSolDB set and persist to disk.

    Reads `data/solubility_aqsoldb.tab` through `_ml_base.load_tdc_tab`, which
    canonicalizes SMILES, drops unparseable rows and missing labels, and sorts
    by canonical SMILES so training order is deterministic.
    """
    import hakase_kernel.base as base
    from sklearn.ensemble import RandomForestRegressor
    from sklearn.model_selection import cross_val_score

    logger.info("SolubilityML: loading vendored %s ...", TDC_FILE)
    smiles, y_raw = base.load_tdc_tab(TDC_FILE)
    y = np.asarray(y_raw, dtype=np.float64)

    logger.info("SolubilityML: featurizing %d compounds...", len(smiles))
    X, kept = _featurize_batch(smiles)
    y_kept = y[kept]
    logger.info(
        "SolubilityML: %d compounds featurized successfully (%d skipped)",
        len(kept),
        len(smiles) - len(kept),
    )

    reg = RandomForestRegressor(
        n_estimators=300,
        max_depth=None,
        min_samples_leaf=2,
        n_jobs=-1,
        random_state=42,
    )

    # Honest 5-fold CV reporting R² + RMSE.
    # IMPORTANT: use `None` (→ JSON null) on failure, NOT float('nan'), because
    # FastAPI/Starlette's strict JSON encoder rejects NaN and would 500 the
    # /models/status and /predict/solubility-ml responses (matching cardiotox).
    logger.info("SolubilityML: running 5-fold CV for performance estimate...")
    cv_r2_mean: float | None
    cv_r2_std: float | None
    cv_rmse_mean: float | None
    cv_rmse_std: float | None

    # error_score="raise" promotes per-fold failures to exceptions (caught
    # below) instead of silently filling with NaN — and the _finite() helper
    # sanitizes any residual NaN/inf (e.g. R² is undefined when a fold's
    # held-out y has zero variance) into None before they hit the JSON layer.
    def _finite(x: float) -> float | None:
        return float(x) if np.isfinite(x) else None

    try:
        r2_scores = cross_val_score(
            reg, X, y_kept, cv=5, scoring="r2", n_jobs=-1, error_score="raise"
        )
        # neg_root_mean_squared_error returns negative values; flip sign.
        rmse_scores = -cross_val_score(
            reg,
            X,
            y_kept,
            cv=5,
            scoring="neg_root_mean_squared_error",
            n_jobs=-1,
            error_score="raise",
        )
        cv_r2_mean = _finite(np.mean(r2_scores))
        cv_r2_std = _finite(np.std(r2_scores))
        cv_rmse_mean = _finite(np.mean(rmse_scores))
        cv_rmse_std = _finite(np.std(rmse_scores))
    except Exception as exc:  # noqa: BLE001
        logger.warning("SolubilityML: CV failed (%s); proceeding without metric", exc)
        cv_r2_mean = None
        cv_r2_std = None
        cv_rmse_mean = None
        cv_rmse_std = None

    logger.info("SolubilityML: fitting final model on full training set...")
    reg.fit(X, y_kept)

    bundle = {
        "version": MODEL_VERSION,
        "model": reg,
        "n_train": int(len(y_kept)),
        "logS_min": float(y_kept.min()),
        "logS_max": float(y_kept.max()),
        "logS_mean": float(y_kept.mean()),
        "cv_r2_mean": cv_r2_mean,
        "cv_r2_std": cv_r2_std,
        "cv_rmse_mean": cv_rmse_mean,
        "cv_rmse_std": cv_rmse_std,
        "morgan_nbits": MORGAN_NBITS,
        "morgan_radius": MORGAN_RADIUS,
        "feature_dim": int(X.shape[1]),
        "trained_at": time.time(),
        # Morgan-bit matrix of the training set, so this endpoint can report an
        # applicability domain the same way the _ml_base family does. The bit
        # block is the leading MORGAN_NBITS columns, identical in layout to
        # _ml_base's, so `base.compute_ad` consumes it directly.
        "training_fps": X[:, :MORGAN_NBITS].astype(np.float32),
    }

    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(MODEL_PATH, "wb") as f:
        pickle.dump(bundle, f)
    logger.info(
        "SolubilityML: model cached to %s (CV R² = %s, RMSE = %s)",
        MODEL_PATH,
        f"{cv_r2_mean:.3f}" if cv_r2_mean is not None else "n/a",
        f"{cv_rmse_mean:.3f}" if cv_rmse_mean is not None else "n/a",
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
                    logger.info("SolubilityML: cache version mismatch, retraining...")
                    bundle = _train()
            else:
                logger.info("SolubilityML: no cache found, training from scratch...")
                bundle = _train()
            _MODEL = bundle
            _TRAIN_METRICS = {
                k: bundle[k]
                for k in (
                    "n_train",
                    "logS_min",
                    "logS_max",
                    "logS_mean",
                    "cv_r2_mean",
                    "cv_r2_std",
                    "cv_rmse_mean",
                    "cv_rmse_std",
                    "trained_at",
                    "version",
                )
            }
            _LOAD_TIME_S = time.time() - t0
            logger.info("SolubilityML: ready in %.2fs", _LOAD_TIME_S)
            return _MODEL
        except Exception as exc:  # noqa: BLE001
            _LOAD_ERROR = f"{type(exc).__name__}: {exc}"
            logger.exception("SolubilityML: failed to load/train model")
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
        "engine": "SolubilityML v2 (Random Forest Regressor on Morgan FP + RDKit descriptors)",
        "metrics": _TRAIN_METRICS,
    }


def warmup() -> dict[str, Any]:
    """Force model load/train (used by /models/warmup endpoint)."""
    try:
        _load_model()
        return {"status": "ready", **is_ready()}
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "error": str(exc), **is_ready()}


def _solubility_class(logs: float) -> str:
    """Map predicted logS → coarse solubility class for the UI badge."""
    if logs > _HIGHLY_SOLUBLE:
        return "Highly soluble"
    if logs > _SOLUBLE:
        return "Soluble"
    if logs > _SLIGHTLY_SOLUBLE:
        return "Slightly soluble"
    return "Insoluble"


def _solubility_mg_per_ml(logs: float, mw: float | None) -> float | None:
    """Convert predicted logS → mg/mL using the molecular weight, if available.

    logS is in mol/L; mg/mL = (10^logS) * MW.
    """
    if mw is None or mw <= 0:
        return None
    try:
        return float(10**logs * mw)
    except OverflowError:
        return None


def _fallback_envelope(smiles: str, error: str) -> dict[str, Any]:
    return {
        "smiles": smiles,
        "source": "fallback",
        "ml_available": False,
        "error": error,
        "prediction": {
            "logS_predicted": None,
            "solubility_class": None,
            "solubility_mg_mL": None,
        },
        "model_info": {
            "engine": "SolubilityML (unavailable)",
            "method": "Model failed to load or featurize; consumer should rely on rule-based ESOL only",
            "load_status": is_ready(),
        },
    }


def predict_solubility_ml(smiles: str) -> dict[str, Any]:
    """Predict aqueous logS for a single SMILES.

    Returns:
        {
          smiles, source: "ml"|"fallback", ml_available,
          prediction: { logS_predicted, solubility_class, solubility_mg_mL },
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
        reg = bundle["model"]
        logs = float(reg.predict(feats.reshape(1, -1))[0])
        inference_time_ms = round((time.time() - t0) * 1000, 2)
    except Exception as exc:  # noqa: BLE001
        logger.exception("SolubilityML inference failed for %s", scrub_smiles(smiles))
        return _fallback_envelope(smiles, f"inference_failed: {exc}")

    # MW lives at index MORGAN_NBITS (first descriptor after the FP).
    try:
        mw = float(feats[MORGAN_NBITS])
    except (IndexError, ValueError):
        mw = None

    # Conformal interval + applicability domain. Both are computed via _ml_base
    # so this endpoint reports uncertainty the same way the rest of the family
    # does: `solubility_logS` has been calibrated by
    # scripts/calibrate_regression_conformal.py for some time, but nothing here
    # consumed it, so the interval was silently dropped before reaching callers.
    import hakase_kernel.base as base

    ci = base.conformal_interval("solubility_logS", logs)
    ci_block = dict(ci)
    if ci["ci_low"] is not None and mw:
        # logS is log10(mol/L); convert the bounds to mg/mL for the UI, keeping
        # low↔low and high↔high (the transform is monotonic).
        ci_block["ci_low_mg_mL"] = _solubility_mg_per_ml(ci["ci_low"], mw)
        ci_block["ci_high_mg_mL"] = _solubility_mg_per_ml(ci["ci_high"], mw)

    ad = base.compute_ad(bundle, feats)

    return {
        "smiles": smiles,
        "source": "ml",
        "ml_available": True,
        "conformal_interval": ci_block,
        "applicability_domain": base.ad_envelope(ad),
        "prediction": {
            "logS_predicted": logs,
            "solubility_class": _solubility_class(logs),
            "solubility_mg_mL": _solubility_mg_per_ml(logs, mw),
        },
        "model_info": {
            "engine": "SolubilityML v2 (Random Forest Regressor on Morgan FP + RDKit descriptors)",
            "method": f"Independent second-opinion logS regressor trained on {DATASET_REF}",
            "training": {
                "dataset": DATASET_REF,
                "n_train": bundle.get("n_train"),
                "logS_min": bundle.get("logS_min"),
                "logS_max": bundle.get("logS_max"),
                "logS_mean": bundle.get("logS_mean"),
            },
            "performance": {
                "cv_r2_mean": bundle.get("cv_r2_mean"),
                "cv_r2_std": bundle.get("cv_r2_std"),
                "cv_rmse_mean": bundle.get("cv_rmse_mean"),
                "cv_rmse_std": bundle.get("cv_rmse_std"),
                "cv_folds": 5,
            },
            "features": {
                "morgan_nbits": bundle.get("morgan_nbits"),
                "morgan_radius": bundle.get("morgan_radius"),
                "rdkit_descriptors": [
                    "MolWt",
                    "MolLogP",
                    "TPSA",
                    "HBD",
                    "HBA",
                    "RotBonds",
                    "AromaticRings",
                    "AromaticProportion",
                    "FractionCSP3",
                ],
            },
            "thresholds": {
                "highly_soluble": _HIGHLY_SOLUBLE,
                "soluble": _SOLUBLE,
                "slightly_soluble": _SLIGHTLY_SOLUBLE,
            },
            "inference_time_ms": inference_time_ms,
            "license": "MIT (HakaseAI internal); training data CC-BY 4.0 (TDC / AqSolDB)",
            "reference": "Sorkun, M. C., Khetan, A. & Er, S. (2019). AqSolDB, a curated reference set of aqueous solubility. Sci. Data 6, 143 — via Therapeutics Data Commons (tdcommons.ai)",
        },
    }
