"""BindingML — DeepDTA-style structure-aware binding affinity regressor.

Independent ML second-opinion that augments the rule-based / ChEMBL-similarity
binding path in `drug_target.py`. Methodologically distinct in three ways:

  1. Different feature representation:
       drug   = 1024-bit Morgan circular fingerprint (r=2) + 8 RDKit
                physicochemical descriptors  → 1032-dim
       target = 480-dim ESM-2 t12 35M mean-pooled per-residue embedding
                of the UniProt sequence       → 480-dim
       concat                                  → 1512-dim
     The protein side carries learned biophysical + evolutionary signal
     across the full sequence — not the 70%-Tanimoto-similar ChEMBL hit
     aggregate, which is a pure database lookup.
  2. Different training data: ~125 curated literature pairs spanning
     ~60 UniProts and ~65 drugs across kinases, GPCRs, COX, HDAC, BCL-2,
     opioid, SERT, GABA-A, ACE/ARB, statins, PARP. See
     `binding_ml_data.py` for the full list. No overlap with the ChEMBL
     similarity index.
  3. Different algorithm class: GradientBoostingRegressor on the
     concatenated feature vector. Better small-N regression behaviour than
     RF for a 1500-dim sparse-ish feature vector, captures interactions
     between drug and protein features invisible to either side alone.

The ESM-2 model is loaded once via `models.protein_ml._load_esm` —
sharing weights with the ProteinML head so the (~140 MB) ESM-2 download
+ ~1.5s warm load happens only once across both models.

Output is a continuous pKd value plus a coarse 4-class label suitable for
the paired-view UI badge:

  pKd ≥ 8  → High affinity      (Kd ≤ 10 nM)
  pKd ≥ 7  → Moderate affinity  (Kd ≤ 100 nM)
  pKd ≥ 6  → Weak affinity      (Kd ≤ 1 µM)
  else     → Negligible

Cutoffs follow common pharma triage practice (cf. the Davis 2011 kinase
panel curation, where >100 nM is typically treated as inactive).
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

# --------------------------------------------------------------------------- #
# Module-level state (singleton)
# --------------------------------------------------------------------------- #

_MODEL: Any = None
_LOAD_LOCK = threading.Lock()
_EMBED_CACHE_LOCK = threading.Lock()  # serializes embed-cache read-modify-write
_LOAD_ERROR: str | None = None
_LOAD_TIME_S: float | None = None
_TRAIN_METRICS: dict[str, Any] = {}

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #

CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "cache")
MODEL_PATH = os.path.join(CACHE_DIR, "binding_ml_gbm.pkl")
EMBED_CACHE_PATH = os.path.join(CACHE_DIR, "binding_ml_embeddings.npz")
MODEL_VERSION = "1.2.0"  # bumped: added training_drug_fps for AD scoring + qualitative disclaimer
EMBED_CACHE_VERSION = "esm2_t12_35M_v1"  # tag stored in NPZ to invalidate stale shapes
MORGAN_NBITS = 1024
MORGAN_RADIUS = 2
N_DRUG_DESCRIPTORS = 8
DRUG_FEATURE_DIM = MORGAN_NBITS + N_DRUG_DESCRIPTORS  # 1032
PROTEIN_FEATURE_DIM = 480  # ESM-2 t12 35M hidden size
FEATURE_DIM = DRUG_FEATURE_DIM + PROTEIN_FEATURE_DIM  # 1512

# pKd class thresholds (Kd in mol/L; pKd = -log10(Kd))
_HIGH_AFFINITY = 8.0   # Kd ≤ 10 nM
_MODERATE = 7.0        # Kd ≤ 100 nM
_WEAK = 6.0            # Kd ≤ 1 µM


# --------------------------------------------------------------------------- #
# Drug featurization
# --------------------------------------------------------------------------- #

def _featurize_drug(smiles: str) -> np.ndarray | None:
    """SMILES → 1032-dim drug feature vector. Returns None on parse failure.

    Same featurization style as `solubility_ml._featurize` — uses
    `rdMolDescriptors` directly (numpy 2.x compat) and avoids the
    `rdkit.Chem.Descriptors` high-level wrapper.
    """
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
        float(rdMolDescriptors.CalcNumRotatableBonds(mol)),
        float(rdMolDescriptors.CalcNumAromaticRings(mol)),
        rdMolDescriptors.CalcFractionCSP3(mol),
    ], dtype=np.float64)

    return np.concatenate([fp_arr.astype(np.float64), desc])


# --------------------------------------------------------------------------- #
# Protein featurization (delegated to protein_ml's ESM-2 loader)
# --------------------------------------------------------------------------- #

def _embed_protein(uniprot_id: str) -> np.ndarray | None:
    """Fetch UniProt sequence + ESM-2 mean-pool embed. Returns None on failure.

    Reuses the singleton ESM-2 model loaded by `models.protein_ml`. If
    ProteinML hasn't loaded ESM-2 yet, this triggers the load (one-time cost
    paid here instead of there).
    """
    from .protein_ml import _embed_sequence, _fetch_sequence

    seq = _fetch_sequence(uniprot_id)
    if not seq:
        return None
    try:
        return _embed_sequence(seq).astype(np.float64)
    except Exception:  # noqa: BLE001
        logger.exception("BindingML: ESM-2 embed failed for %s", uniprot_id)
        return None


# --------------------------------------------------------------------------- #
# Cache helpers — protein embeddings (drug FPs are cheap, recomputed on demand)
# --------------------------------------------------------------------------- #

_VERSION_SENTINEL_KEY = "__embed_cache_version__"


def _load_embed_cache() -> dict[str, np.ndarray]:
    """Load + validate the per-UniProt ESM-2 embedding cache.

    Drops the cache entirely if (a) the version sentinel is missing or wrong
    or (b) any stored vector has the wrong dimension — this prevents silent
    feature-shape mismatches if PROTEIN_FEATURE_DIM ever changes.
    """
    if not os.path.exists(EMBED_CACHE_PATH):
        return {}
    try:
        with np.load(EMBED_CACHE_PATH, allow_pickle=False) as npz:
            keys = list(npz.files)
            # version-sentinel check — stored as a single-byte uint8 array
            # whose name is the version tag itself, so any rename invalidates.
            if not any(k.startswith("__embed_cache_version__") for k in keys):
                logger.warning("BindingML: embed cache has no version sentinel; rebuilding")
                return {}
            version_keys = [k for k in keys if k.startswith("__embed_cache_version__")]
            stored_version = version_keys[0].removeprefix("__embed_cache_version__::")
            if stored_version != EMBED_CACHE_VERSION:
                logger.warning(
                    "BindingML: embed cache version mismatch (stored=%s, expected=%s); rebuilding",
                    stored_version, EMBED_CACHE_VERSION,
                )
                return {}
            out: dict[str, np.ndarray] = {}
            for k in keys:
                if k.startswith("__"):
                    continue
                arr = npz[k]
                if arr.ndim != 1 or arr.shape[0] != PROTEIN_FEATURE_DIM:
                    logger.warning(
                        "BindingML: embed cache entry %s has wrong shape %s; rebuilding cache",
                        k, arr.shape,
                    )
                    return {}
                out[k] = arr
            return out
    except Exception as exc:  # noqa: BLE001
        logger.warning("BindingML: embedding cache unreadable (%s); rebuilding", exc)
        return {}


def _atomic_write(path: str, writer) -> None:
    """Write to <path>.tmp.<pid>, fsync, then os.replace into <path>.

    Concurrent writers are serialized externally via _EMBED_CACHE_LOCK /
    _LOAD_LOCK; this helper guarantees readers never observe a partial file
    even if a writer crashes mid-write.
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp.{os.getpid()}.{int(time.time()*1000)}"
    try:
        with open(tmp, "wb") as fh:
            writer(fh)
            fh.flush()
            try:
                os.fsync(fh.fileno())
            except OSError:
                pass  # best-effort; some filesystems don't support fsync
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass


def _save_embed_cache(cache: dict[str, np.ndarray]) -> None:
    """Persist the embed cache atomically. Caller must hold _EMBED_CACHE_LOCK."""
    payload: dict[str, np.ndarray] = dict(cache)
    # Version sentinel: empty array whose KEY encodes the version tag.
    payload[f"__embed_cache_version__::{EMBED_CACHE_VERSION}"] = np.zeros(0, dtype=np.uint8)
    def _writer(fh):
        np.savez(fh, **payload)
    _atomic_write(EMBED_CACHE_PATH, _writer)


# --------------------------------------------------------------------------- #
# Train + cache
# --------------------------------------------------------------------------- #

def _train() -> dict[str, Any]:
    """Train a GBM regressor on the curated (drug, target, pKd) set."""
    from sklearn.ensemble import GradientBoostingRegressor
    from sklearn.model_selection import GroupKFold, KFold, cross_val_score

    from .binding_ml_data import get_training_data

    logger.info("BindingML: loading curated training set...")
    data = get_training_data()

    # Pre-compute drug features (cheap) and per-target embeddings (expensive,
    # cached in NPZ keyed by uniprot_id). Embed-cache RMW is serialized via
    # _EMBED_CACHE_LOCK so concurrent prewarm + first-request writers can't
    # clobber each other's NPZ file.
    with _EMBED_CACHE_LOCK:
        embed_cache = _load_embed_cache()
        embed_cache_dirty = False

        # Group entries by UniProt so we embed each protein at most once even
        # if it appears N times across the training rows.
        unique_uniprots = sorted({uid for _, uid, _, _ in data})
        logger.info("BindingML: %d unique UniProts in training set", len(unique_uniprots))

        for uid in unique_uniprots:
            if uid in embed_cache:
                continue
            logger.info("BindingML: embedding %s (cache miss, fetching from UniProt)", uid)
            emb = _embed_protein(uid)
            if emb is None:
                logger.warning("BindingML: skipping %s — embedding failed", uid)
                # NaN-marker: row using this UniProt will be skipped during
                # featurization. Don't persist NaN rows to the cache file —
                # next start should retry the fetch instead of inheriting
                # a stale failure.
                embed_cache[uid] = np.full(PROTEIN_FEATURE_DIM, np.nan, dtype=np.float64)
            else:
                embed_cache[uid] = emb
                embed_cache_dirty = True

        if embed_cache_dirty:
            # Strip NaN entries before persisting so failures retry next start.
            persistable = {k: v for k, v in embed_cache.items()
                           if not np.isnan(v).any()}
            _save_embed_cache(persistable)
            logger.info("BindingML: persisted %d valid embeddings to cache "
                        "(NaN failures NOT persisted, will retry next start)",
                        len(persistable))

    Xs: list[np.ndarray] = []
    ys: list[float] = []
    groups: list[str] = []  # UniProt id per row → for GroupKFold
    skipped = 0

    for smiles, uid, pkd, _src in data:
        drug_feat = _featurize_drug(smiles)
        if drug_feat is None:
            skipped += 1
            continue
        prot_feat = embed_cache.get(uid)
        if prot_feat is None or np.isnan(prot_feat).any():
            skipped += 1
            continue
        Xs.append(np.concatenate([drug_feat, prot_feat]))
        ys.append(pkd)
        groups.append(uid)

    if not Xs:
        raise RuntimeError("BindingML: no training rows survived featurization")

    X = np.vstack(Xs)
    y = np.asarray(ys, dtype=np.float64)
    grp_arr = np.asarray(groups)
    logger.info("BindingML: %d training rows (%d skipped), feature dim = %d",
                len(y), skipped, X.shape[1])

    reg = GradientBoostingRegressor(
        n_estimators=300,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.85,
        random_state=42,
    )

    # Honest 5-fold CV reporting R² + RMSE + Pearson r.
    # IMPORTANT: NaN/inf → None for FastAPI's strict JSON encoder (matches
    # cardiotox / solubility_ml pattern).
    def _finite(x: float) -> float | None:
        return float(x) if np.isfinite(x) else None

    cv_r2_mean: float | None
    cv_r2_std: float | None
    cv_rmse_mean: float | None
    cv_rmse_std: float | None
    cv_pearson_mean: float | None
    cv_pearson_std: float | None
    # Pass 1 — random KFold (in-distribution upper bound; same target may
    # appear in train and test folds, so this is an OPTIMISTIC estimate).
    try:
        kf = KFold(n_splits=5, shuffle=True, random_state=42)
        r2_scores = cross_val_score(reg, X, y, cv=kf, scoring="r2",
                                    n_jobs=-1, error_score="raise")
        rmse_scores = -cross_val_score(reg, X, y, cv=kf,
                                       scoring="neg_root_mean_squared_error",
                                       n_jobs=-1, error_score="raise")
        cv_r2_mean = _finite(np.mean(r2_scores))
        cv_r2_std = _finite(np.std(r2_scores))
        cv_rmse_mean = _finite(np.mean(rmse_scores))
        cv_rmse_std = _finite(np.std(rmse_scores))

        # Pearson r per fold — sklearn doesn't expose it, so do it manually.
        pearsons: list[float] = []
        for tr, te in kf.split(X):
            reg.fit(X[tr], y[tr])
            yp = reg.predict(X[te])
            if np.std(y[te]) > 0 and np.std(yp) > 0:
                pearsons.append(float(np.corrcoef(y[te], yp)[0, 1]))
        cv_pearson_mean = _finite(np.mean(pearsons)) if pearsons else None
        cv_pearson_std = _finite(np.std(pearsons)) if pearsons else None
    except Exception as exc:  # noqa: BLE001
        logger.warning("BindingML: random-KFold CV failed (%s); proceeding without metric", exc)
        cv_r2_mean = cv_r2_std = None
        cv_rmse_mean = cv_rmse_std = None
        cv_pearson_mean = cv_pearson_std = None

    # Pass 2 — GroupKFold by UniProt (leave-target-out: every test fold contains
    # ONLY targets the model has never seen, so this is a REALISTIC lower bound
    # for novel-target generalization). Number of unique groups bounds n_splits.
    grp_cv_r2_mean: float | None
    grp_cv_r2_std: float | None
    grp_cv_rmse_mean: float | None
    grp_cv_rmse_std: float | None
    n_groups = int(len(np.unique(grp_arr)))
    n_grp_splits = min(5, n_groups)
    try:
        if n_grp_splits >= 2:
            gkf = GroupKFold(n_splits=n_grp_splits)
            grp_r2 = cross_val_score(reg, X, y, cv=gkf.split(X, y, groups=grp_arr),
                                     scoring="r2", n_jobs=-1, error_score="raise")
            grp_rmse = -cross_val_score(reg, X, y, cv=gkf.split(X, y, groups=grp_arr),
                                        scoring="neg_root_mean_squared_error",
                                        n_jobs=-1, error_score="raise")
            grp_cv_r2_mean = _finite(np.mean(grp_r2))
            grp_cv_r2_std = _finite(np.std(grp_r2))
            grp_cv_rmse_mean = _finite(np.mean(grp_rmse))
            grp_cv_rmse_std = _finite(np.std(grp_rmse))
        else:
            grp_cv_r2_mean = grp_cv_r2_std = None
            grp_cv_rmse_mean = grp_cv_rmse_std = None
    except Exception as exc:  # noqa: BLE001
        logger.warning("BindingML: GroupKFold CV failed (%s); leave-target-out unavailable", exc)
        grp_cv_r2_mean = grp_cv_r2_std = None
        grp_cv_rmse_mean = grp_cv_rmse_std = None

    logger.info("BindingML: fitting final model on full training set...")
    reg.fit(X, y)

    # Store training drug Morgan FP matrix for Applicability Domain (AD) scoring.
    # We use only the drug FP columns (first MORGAN_NBITS) for Tanimoto — the
    # protein embedding dimensions are not bit-vectors and Tanimoto doesn't apply.
    training_drug_fps = X[:, :MORGAN_NBITS].astype(np.float32)

    bundle: dict[str, Any] = {
        "version": MODEL_VERSION,
        "model": reg,
        "n_train": int(len(y)),
        "n_unique_targets": int(n_groups),
        "n_unique_drugs": int(len({s for s, _, _, _ in data})),
        "pkd_min": float(y.min()),
        "pkd_max": float(y.max()),
        "pkd_mean": float(y.mean()),
        # Random-KFold (in-distribution; OPTIMISTIC)
        "cv_r2_mean": cv_r2_mean,
        "cv_r2_std": cv_r2_std,
        "cv_rmse_mean": cv_rmse_mean,
        "cv_rmse_std": cv_rmse_std,
        "cv_pearson_mean": cv_pearson_mean,
        "cv_pearson_std": cv_pearson_std,
        # GroupKFold by UniProt (leave-target-out; REALISTIC novel-target floor)
        "cv_grp_r2_mean": grp_cv_r2_mean,
        "cv_grp_r2_std": grp_cv_r2_std,
        "cv_grp_rmse_mean": grp_cv_rmse_mean,
        "cv_grp_rmse_std": grp_cv_rmse_std,
        "cv_grp_n_splits": int(n_grp_splits),
        "morgan_nbits": MORGAN_NBITS,
        "morgan_radius": MORGAN_RADIUS,
        "drug_feature_dim": DRUG_FEATURE_DIM,
        "protein_feature_dim": PROTEIN_FEATURE_DIM,
        "feature_dim": int(X.shape[1]),
        "trained_at": time.time(),
        "training_drug_fps": training_drug_fps,  # (n_train, 1024) float32 for drug-side AD scoring
    }

    # Atomic write — never leave a partial pickle on disk if we crash.
    def _writer(fh):
        pickle.dump(bundle, fh)
    _atomic_write(MODEL_PATH, _writer)
    logger.info("BindingML: model cached to %s | random-KFold R²=%s RMSE=%s r=%s | "
                "GroupKFold-by-UniProt R²=%s RMSE=%s (n_splits=%d)",
                MODEL_PATH,
                f"{cv_r2_mean:.3f}" if cv_r2_mean is not None else "n/a",
                f"{cv_rmse_mean:.3f}" if cv_rmse_mean is not None else "n/a",
                f"{cv_pearson_mean:.3f}" if cv_pearson_mean is not None else "n/a",
                f"{grp_cv_r2_mean:.3f}" if grp_cv_r2_mean is not None else "n/a",
                f"{grp_cv_rmse_mean:.3f}" if grp_cv_rmse_mean is not None else "n/a",
                n_grp_splits)
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
                    logger.info("BindingML: cache version mismatch, retraining...")
                    bundle = _train()
            else:
                logger.info("BindingML: no cache found, training from scratch...")
                bundle = _train()
            _MODEL = bundle
            _TRAIN_METRICS = {
                k: bundle.get(k) for k in (
                    "n_train", "n_unique_targets", "n_unique_drugs",
                    "pkd_min", "pkd_max", "pkd_mean",
                    "cv_r2_mean", "cv_r2_std",
                    "cv_rmse_mean", "cv_rmse_std",
                    "cv_pearson_mean", "cv_pearson_std",
                    "cv_grp_r2_mean", "cv_grp_r2_std",
                    "cv_grp_rmse_mean", "cv_grp_rmse_std",
                    "cv_grp_n_splits",
                    "trained_at", "version",
                )
            }
            _LOAD_TIME_S = time.time() - t0
            logger.info("BindingML: ready in %.2fs", _LOAD_TIME_S)
            return _MODEL
        except Exception as exc:  # noqa: BLE001
            _LOAD_ERROR = f"{type(exc).__name__}: {exc}"
            logger.exception("BindingML: failed to load/train model")
            raise


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #

def is_ready() -> dict[str, Any]:
    """Report load status without forcing a load (mirrors cardiotox / solubility_ml)."""
    return {
        "loaded": _MODEL is not None,
        "load_time_s": _LOAD_TIME_S,
        "error": _LOAD_ERROR,
        "engine": "BindingML v1 (Morgan FP + RDKit descriptors ⊕ ESM-2 t12 35M → Gradient Boosting Regressor)",
        "metrics": _TRAIN_METRICS,
    }


def warmup() -> dict[str, Any]:
    """Force model load/train (used by /models/warmup endpoint and prewarm thread)."""
    try:
        _load_model()
        return {"status": "ready", **is_ready()}
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "error": str(exc), **is_ready()}


def _compute_ad(bundle: dict[str, Any], drug_fp: np.ndarray) -> dict[str, Any]:
    """Drug-side Applicability Domain via Tanimoto nearest-neighbor.

    Only the drug fingerprint is used for Tanimoto (protein embedding is not
    a bit-vector so Tanimoto is not meaningful on that side).
    """
    training_fps = bundle.get("training_drug_fps")
    if training_fps is None or len(training_fps) == 0:
        return {"ad_tanimoto_nearest": None, "ad_in_domain": None}
    q = drug_fp[:MORGAN_NBITS].astype(np.float32)
    T = training_fps
    dot = T @ q
    sum_q = float(q.sum())
    sum_T = T.sum(axis=1)
    union = sum_q + sum_T - dot
    tanimoto = np.where(union > 0, dot / union, 0.0)
    nearest = float(tanimoto.max())
    return {"ad_tanimoto_nearest": round(nearest, 4), "ad_in_domain": bool(nearest >= 0.4)}


def _affinity_class(pkd: float) -> str:
    """Map predicted pKd → coarse affinity class for the UI badge."""
    if pkd >= _HIGH_AFFINITY:
        return "High affinity"
    if pkd >= _MODERATE:
        return "Moderate affinity"
    if pkd >= _WEAK:
        return "Weak affinity"
    return "Negligible"


def _kd_nm(pkd: float) -> float | None:
    """Convert pKd → Kd in nM. Caps the dynamic range so JSON stays sane."""
    try:
        kd_M = 10.0 ** (-pkd)
        return float(kd_M * 1e9)
    except OverflowError:
        return None


def _fallback_envelope(smiles: str, uniprot_id: str, error: str) -> dict[str, Any]:
    return {
        "smiles": smiles,
        "uniprot_id": uniprot_id,
        "source": "fallback",
        "ml_available": False,
        "error": error,
        "prediction": {
            "pKd_predicted": None,
            "Kd_nM": None,
            "affinity_class": None,
        },
        "model_info": {
            "engine": "BindingML (unavailable)",
            "method": "Model failed to load, SMILES failed to parse, or UniProt sequence lookup failed; consumer should rely on the ChEMBL-similarity binding path only",
            "load_status": is_ready(),
        },
    }


def predict_binding_ml(smiles: str, uniprot_id: str) -> dict[str, Any]:
    """Predict pKd for a single (SMILES, UniProt) pair.

    Returns:
        {
          smiles, uniprot_id, source: "ml"|"fallback", ml_available,
          prediction: { pKd_predicted, Kd_nM, affinity_class },
          model_info: { engine, method, training, performance, ... }
        }

    Raises:
        ValueError if either argument is empty/whitespace (true client error → 4xx).
    """
    if not smiles or not smiles.strip():
        raise ValueError("smiles is required")
    if not uniprot_id or not uniprot_id.strip():
        raise ValueError("uniprot_id is required")
    uniprot_id = uniprot_id.strip().upper()

    try:
        bundle = _load_model()
    except Exception as exc:  # noqa: BLE001
        return _fallback_envelope(smiles, uniprot_id, f"model_load_failed: {exc}")

    drug_feat = _featurize_drug(smiles)
    if drug_feat is None:
        return _fallback_envelope(smiles, uniprot_id, "rdkit_could_not_parse_smiles")

    # Try the in-process embedding cache first — usually a hit for any
    # UniProt that was in the training set or any prior request. The lock
    # serializes the read-modify-write against the prewarm thread and any
    # concurrent /predict-binding-ml callers so we never clobber the NPZ.
    with _EMBED_CACHE_LOCK:
        embed_cache = _load_embed_cache()
        prot_feat = embed_cache.get(uniprot_id)
        if prot_feat is None or (isinstance(prot_feat, np.ndarray) and np.isnan(prot_feat).any()):
            prot_feat = _embed_protein(uniprot_id)
            if prot_feat is None:
                return _fallback_envelope(smiles, uniprot_id, "uniprot_lookup_or_embedding_failed")
            # Persist for next call (atomic write under lock).
            embed_cache[uniprot_id] = prot_feat
            try:
                _save_embed_cache(embed_cache)
            except Exception as exc:  # noqa: BLE001
                logger.warning("BindingML: failed to persist new embedding (%s)", exc)

    try:
        t0 = time.time()
        feats = np.concatenate([drug_feat, prot_feat.astype(np.float64)]).reshape(1, -1)
        reg = bundle["model"]
        pkd = float(reg.predict(feats)[0])
        inference_time_ms = round((time.time() - t0) * 1000, 2)
    except Exception as exc:  # noqa: BLE001
        logger.exception("BindingML inference failed for SMILES=%r UID=%s", smiles, uniprot_id)
        return _fallback_envelope(smiles, uniprot_id, f"inference_failed: {exc}")

    ad = _compute_ad(bundle, drug_feat)

    return {
        "smiles": smiles,
        "uniprot_id": uniprot_id,
        "source": "ml",
        "ml_available": True,
        "prediction": {
            "pKd_predicted": pkd,
            "Kd_nM": _kd_nm(pkd),
            "affinity_class": _affinity_class(pkd),
        },
        "applicability_domain": {
            "ad_tanimoto_nearest": ad["ad_tanimoto_nearest"],
            "ad_in_domain": ad["ad_in_domain"],
            "ad_threshold": 0.4,
            "ad_note": (
                "Drug in-domain: model interpolates within training set drug chemistry."
                if ad["ad_in_domain"]
                else "Drug out-of-domain: query drug is structurally distant from training set — pKd prediction less reliable."
            ) if ad["ad_in_domain"] is not None else "AD scoring unavailable",
        },
        "qualitative_disclaimer": (
            f"QUALITATIVE SECOND OPINION ONLY. Training set: n_train={bundle.get('n_train')} pairs, "
            f"{bundle.get('n_unique_targets')} unique targets. "
            f"GroupKFold (leave-target-out) R²={bundle.get('cv_grp_r2_mean')}. "
            "Absolute pKd values must be validated by wet-lab binding assay before any medicinal chemistry conclusion."
        ),
        "model_info": {
            "engine": "BindingML v1 (Morgan FP + RDKit descriptors ⊕ ESM-2 t12 35M → Gradient Boosting Regressor)",
            "method": (
                "Independent second-opinion regressor on concatenated drug + protein-LM "
                "features. Reports two CV regimes side-by-side: random KFold "
                "(in-distribution upper bound — same target may appear in train and "
                "test folds) AND GroupKFold by UniProt (leave-target-out lower bound "
                "for novel-target generalization). Treat as exploratory; small N (~110) "
                "and curated-literature dataset means absolute pKd values should always "
                "be cross-checked against the ChEMBL-similarity path or wet-lab data."
            ),
            "training": {
                "dataset": "Curated literature pKd pairs (Karaman 2008, Davis 2011, BindingDB, Drug labels). Placeholder/family-archetype rows removed in v1.1.",
                "n_train": bundle.get("n_train"),
                "n_unique_targets": bundle.get("n_unique_targets"),
                "n_unique_drugs": bundle.get("n_unique_drugs"),
                "pkd_min": bundle.get("pkd_min"),
                "pkd_max": bundle.get("pkd_max"),
                "pkd_mean": bundle.get("pkd_mean"),
            },
            "performance": {
                # Random KFold — OPTIMISTIC (same target may appear in train + test)
                "cv_r2_mean": bundle.get("cv_r2_mean"),
                "cv_r2_std": bundle.get("cv_r2_std"),
                "cv_rmse_mean": bundle.get("cv_rmse_mean"),
                "cv_rmse_std": bundle.get("cv_rmse_std"),
                "cv_pearson_mean": bundle.get("cv_pearson_mean"),
                "cv_pearson_std": bundle.get("cv_pearson_std"),
                "cv_folds": 5,
                # GroupKFold by UniProt — REALISTIC (leave-target-out floor)
                "cv_grp_r2_mean": bundle.get("cv_grp_r2_mean"),
                "cv_grp_r2_std": bundle.get("cv_grp_r2_std"),
                "cv_grp_rmse_mean": bundle.get("cv_grp_rmse_mean"),
                "cv_grp_rmse_std": bundle.get("cv_grp_rmse_std"),
                "cv_grp_n_splits": bundle.get("cv_grp_n_splits"),
                "cv_grp_scheme": "GroupKFold by UniProt (leave-target-out)",
            },
            "features": {
                "morgan_nbits": bundle.get("morgan_nbits"),
                "morgan_radius": bundle.get("morgan_radius"),
                "rdkit_descriptors": [
                    "MolWt", "MolLogP", "TPSA", "HBD", "HBA",
                    "RotBonds", "AromaticRings", "FractionCSP3",
                ],
                "esm_model": "facebook/esm2_t12_35M_UR50D",
                "protein_feature_dim": bundle.get("protein_feature_dim"),
                "feature_dim_total": bundle.get("feature_dim"),
            },
            "thresholds": {
                "high_affinity_pkd": _HIGH_AFFINITY,
                "moderate_pkd": _MODERATE,
                "weak_pkd": _WEAK,
            },
            "inference_time_ms": inference_time_ms,
            "license": "MIT (HakaseAI internal); ESM-2 weights MIT (Meta AI Research)",
            "reference": "Öztürk, H., Özgür, A., Ozkirimli, E. (2018). DeepDTA: deep drug-target binding affinity prediction. Bioinformatics 34(17), i821-i829.",
        },
    }
