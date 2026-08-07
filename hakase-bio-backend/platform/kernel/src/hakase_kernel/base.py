"""Shared featurization / training / applicability-domain plumbing for
the family of single-endpoint TDC second-opinion models.

Models built on top of this base (`ames_ml`, `caco2_ml`, `vdss_ml`,
`half_life_ml`, …) share the exact methodology already used by `cardiotox.py`
and `dili_ml.py`:

  * Featurization: RDKit Morgan circular fingerprint (1024-bit, radius 2)
    plus 6 physicochemical descriptors (MolWt, MolLogP, TPSA, HBD, HBA,
    FractionCSP3).
  * Training: sklearn RandomForest{Classifier|Regressor}, deterministic
    (n_jobs=1, random_state=42), 5-fold CV performance reported.
  * Storage: pickled bundle on disk, retrained automatically when the
    on-disk version doesn't match the module MODEL_VERSION.
  * Applicability Domain: Tanimoto to nearest training-set molecule.
  * NO fake fallback: if the model can't load/train, the endpoint surfaces
    a source="fallback" envelope with ml_available=False and the concrete
    error. It never returns a fabricated probability or value.

The base loads its data from the vendored TDC .tab files shipped by whichever
modality owns the endpoint, so the model is fully self-contained — no network
call required for a fresh cold-start. The modality registers its dataset
directory via `runtime.paths.register_dataset_dir`; the kernel does not know
where those files live.
"""

from __future__ import annotations

import json
import logging
import os
import pickle
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np

from hakase_kernel.runtime.paths import cache_dir, dataset_dirs, resolve_artifact, resolve_dataset

logger = logging.getLogger(__name__)

# Feature constants — identical to cardiotox.py so any downstream analytics
# that computes Tanimoto across model families sees the same bit space.
MORGAN_NBITS = 1024
MORGAN_RADIUS = 2
DESCRIPTOR_NAMES = ["MolWt", "MolLogP", "TPSA", "HBD", "HBA", "FractionCSP3"]
FEATURE_DIM = MORGAN_NBITS + len(DESCRIPTOR_NAMES)

# On-disk cache directory (shared with cardiotox/dili_ml).
CACHE_DIR = str(cache_dir())

# In-domain threshold for Tanimoto to nearest training neighbor.
AD_THRESHOLD = 0.4


# --------------------------------------------------------------------------- #
# Featurization
# --------------------------------------------------------------------------- #


def canonicalize(smiles: str) -> str | None:
    """Return RDKit canonical SMILES, or None if unparseable."""
    from rdkit import Chem

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    return Chem.MolToSmiles(mol, canonical=True)


def featurize(smiles: str) -> np.ndarray | None:
    """SMILES → 1030-vector (1024 Morgan bits + 6 RDKit descriptors), or
    None on parse failure. Always canonicalizes first."""
    from rdkit import Chem
    from rdkit.Chem import AllChem, Crippen, rdMolDescriptors
    from rdkit.DataStructs import ConvertToNumpyArray

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    mol = Chem.MolFromSmiles(Chem.MolToSmiles(mol, canonical=True))
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


def featurize_batch(smiles_list: list[str]) -> tuple[np.ndarray, list[int]]:
    """Featurize a batch, dropping unparseable SMILES. Returns (X, kept_idx)."""
    rows: list[np.ndarray] = []
    kept: list[int] = []
    for i, s in enumerate(smiles_list):
        v = featurize(s)
        if v is not None:
            rows.append(v)
            kept.append(i)
    if not rows:
        return np.empty((0, FEATURE_DIM), dtype=np.float64), []
    return np.vstack(rows), kept


# --------------------------------------------------------------------------- #
# Dataset loader (vendored TDC .tab)
# --------------------------------------------------------------------------- #


def load_tdc_tab(
    filename: str,
    smiles_col: str = "Drug",
    label_col: str = "Y",
    row_filter: Callable[[Any], Any] | None = None,
) -> tuple[list[str], np.ndarray]:
    """Load a vendored TDC `.tab` file → (smiles_list, y_array).

    Skips rows with unparseable SMILES (RDKit MolFromSmiles == None).
    Canonicalizes SMILES and sorts by canonical form for deterministic
    training order.

    `row_filter` is an optional DataFrame→DataFrame callable applied BEFORE
    canonicalization. It exists for datasets whose rows are not all valid
    training examples for the endpoint being modelled — e.g. `ppbr_az.tab`
    pools five species, and a *human* plasma-protein-binding model must not
    train on rat/dog/mouse measurements. Filtering here (rather than in each
    caller) keeps `smiles` and `y` index-aligned by construction.
    """
    import pandas as pd
    from rdkit import Chem as _Chem

    path = resolve_dataset(filename)
    if path is None:
        searched = [str(d) for d in dataset_dirs()] or ["<no dataset directory registered>"]
        raise FileNotFoundError(
            f"vendored TDC file missing: {filename}; searched {', '.join(searched)}"
        )

    df = pd.read_csv(path, sep="\t")
    if smiles_col not in df.columns:
        raise KeyError(
            f"{filename}: expected SMILES column {smiles_col!r}, " f"got {list(df.columns)}"
        )
    if label_col not in df.columns:
        raise KeyError(
            f"{filename}: expected label column {label_col!r}, " f"got {list(df.columns)}"
        )

    if row_filter is not None:
        df = row_filter(df)
        if len(df) == 0:
            raise ValueError(f"{filename}: row_filter removed every row")

    def _canon(s: str) -> str | None:
        mol = _Chem.MolFromSmiles(str(s))
        return _Chem.MolToSmiles(mol, canonical=True) if mol is not None else None

    df["_canon"] = df[smiles_col].apply(_canon)
    # Drop unparseable SMILES *and* missing labels — an NaN label silently
    # poisons RF training (or crashes CV) rather than failing loudly.
    df = df.dropna(subset=["_canon", label_col]).sort_values("_canon").reset_index(drop=True)
    return df["_canon"].tolist(), df[label_col].to_numpy()


# --------------------------------------------------------------------------- #
# Applicability Domain
# --------------------------------------------------------------------------- #


def compute_ad(bundle: dict[str, Any], query_feat: np.ndarray) -> dict[str, Any]:
    """Tanimoto to nearest training-set molecule using Morgan bits only."""
    training_fps = bundle.get("training_fps")
    if training_fps is None or len(training_fps) == 0:
        return {"ad_tanimoto_nearest": None, "ad_in_domain": None}

    q = query_feat[:MORGAN_NBITS].astype(np.float32)
    T = training_fps
    dot = T @ q
    sum_q = float(q.sum())
    sum_T = T.sum(axis=1)
    union = sum_q + sum_T - dot
    tanimoto = np.where(union > 0, dot / union, 0.0)
    nearest = float(tanimoto.max())
    return {
        "ad_tanimoto_nearest": round(nearest, 4),
        "ad_in_domain": bool(nearest >= AD_THRESHOLD),
    }


def ad_envelope(ad: dict[str, Any]) -> dict[str, Any]:
    """Standard applicability-domain block for the response envelope."""
    if ad["ad_in_domain"] is None:
        note = "AD scoring unavailable (no training FP matrix in bundle)"
    elif ad["ad_in_domain"]:
        note = "In-domain: model interpolates within training set chemistry."
    else:
        note = (
            "Out-of-domain: query is structurally distant from training set "
            "— predictions less reliable."
        )
    return {
        "ad_tanimoto_nearest": ad["ad_tanimoto_nearest"],
        "ad_in_domain": ad["ad_in_domain"],
        "ad_threshold": AD_THRESHOLD,
        "ad_note": note,
    }


# --------------------------------------------------------------------------- #
# Probability-calibration helpers (shared by the safety classifiers)
# --------------------------------------------------------------------------- #


def positive_class_proba(clf: Any, X: np.ndarray) -> np.ndarray:
    """Positive-class (class 1) column of ``clf.predict_proba(X)``.

    Mirrors the raw-score extraction used across the safety heads. Raises on a
    single-class model rather than silently returning a 100%/0% column — the same
    honest-failure stance as ``predict_classification_probability``.
    """
    proba = clf.predict_proba(X)
    classes = list(clf.classes_)
    if 1 in classes:
        return proba[:, classes.index(1)]
    if len(classes) == 1:
        raise ValueError(f"model saw only one class {classes[0]!r}; cannot output P(active)")
    return proba[:, -1]


def expected_calibration_error(y_true: Any, y_prob: Any, n_bins: int = 10) -> float | None:
    """Expected Calibration Error with ``n_bins`` equal-width bins on [0, 1].

    ECE = Σ_b (n_b/N)·|acc(b) − conf(b)|, where acc(b) is the empirical positive
    rate and conf(b) the mean predicted probability in bin b. Returns None on an
    empty input. Lower is better; a perfectly calibrated model has ECE → 0.
    """
    y = np.asarray(y_true, dtype=float).ravel()
    p = np.asarray(y_prob, dtype=float).ravel()
    if y.size == 0 or y.size != p.size:
        return None
    # Bin edges 0..1; interior edges for digitize so p==1.0 lands in the last bin.
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    idx = np.clip(np.digitize(p, edges[1:-1], right=False), 0, n_bins - 1)
    n = y.size
    ece = 0.0
    for b in range(n_bins):
        mask = idx == b
        nb = int(mask.sum())
        if nb == 0:
            continue
        acc = float(y[mask].mean())
        conf = float(p[mask].mean())
        ece += (nb / n) * abs(acc - conf)
    return float(ece)


# --------------------------------------------------------------------------- #
# Base training / persistence
# --------------------------------------------------------------------------- #

TaskKind = Literal["classification", "regression"]


@dataclass
class ModelSpec:
    """Declarative spec for a single-endpoint TDC second-opinion model.

    Fields:
        model_id     Short snake_case id, used to derive cache filename.
        version      Bump when features/hyperparams/label logic change; forces retrain.
        tdc_file     Vendored TDC `.tab` filename in hakase_smallmol/data/.
        smiles_col   Column name for SMILES in the TDC file.
        label_col    Column name for the label in the TDC file.
        task         "classification" or "regression".
        prep_labels  Optional callable to transform raw labels before training
                     (e.g. binarize, log-transform). Applied to the numpy array
                     of labels; must return a numpy array of the same length.
        row_filter   Optional DataFrame→DataFrame callable applied to the raw
                     table before canonicalization, for datasets that pool rows
                     which are not all valid examples of the modelled endpoint
                     (e.g. the multi-species `ppbr_az.tab`).
        label_units  Human-readable units of the TRAINED label, after
                     `prep_labels`. Surfaced in the response envelope so a
                     log-transformed endpoint can never be misread as linear.
        title        Human-friendly engine title used in the response envelope.
        method       One-line description of the method used.
        dataset_ref  Human-friendly citation for the training dataset.
    """

    model_id: str
    version: str
    tdc_file: str
    task: TaskKind
    title: str
    method: str
    dataset_ref: str
    smiles_col: str = "Drug"
    label_col: str = "Y"
    prep_labels: Callable[[np.ndarray], np.ndarray] | None = None
    row_filter: Callable[[Any], Any] | None = None
    label_units: str | None = None
    # Opt-in isotonic probability calibration for a classification endpoint.
    # OFF by default: enabling it carves a three-way fit/cal/test split (so the
    # final RF trains on less data) and changes the served probability to a
    # calibrated value + refits the conformal veto on the calibrated scale
    # (mirrors models/tox21_ml.py). Only turn it on for endpoints that need a
    # trustworthy probability magnitude (the core safety classifiers), never as a
    # blanket default across the _ml_base family.
    calibrate_isotonic: bool = False


def _cache_path(spec: ModelSpec) -> str:
    return os.path.join(CACHE_DIR, f"{spec.model_id}_v{spec.version}.pkl")


# α for the conformal veto (bound on FPR against true-inactive compounds).
_ISO_VETO_ALPHA = 0.05
_ISO_TEST_FRACTION = 0.20
_ISO_CAL_FRACTION = 0.20
_ISO_SEED = 42


# ChEMBL approved/withdrawn hold-out snapshot — the reference NEGATIVE population
# (approved drugs) for the safety-veto FPR guarantee. The veto/screen thresholds
# for hERG/DILI/Ames are the conformal quantiles of the CALIBRATED approved-drug
# scores, so P(flag | approved) ≤ α holds on the served (calibrated) scale — the
# same guarantee the offline cache/conformal_calibration.json provided, refit here
# inline on the calibrated scale and stored in the model bundle.
_SNAPSHOT_DIR = os.path.join(os.path.dirname(__file__), "..", "validation", "snapshots")
_WATCH_ALPHA = 0.20  # FPR-controlled WATCH screen (P(WATCH | approved) ≤ 0.20)

# PINNED hold-out snapshot for the safety-veto calibration. Deliberately a fixed
# filename, NOT "newest match": these thresholds are safety-critical, so a new
# snapshot dropping into the directory must never silently shift the veto on the
# next retrain. Bumping this is a reviewed one-line change — same versioned-artifact
# discipline as the rest of the stack (matches conformal_calibration.json's
# holdout_snapshot). Keep in sync with scripts/calibrate_conformal_thresholds.py.
_HOLDOUT_SNAPSHOT = "verdict_holdout_20260712.json"


def _pinned_holdout_snapshot() -> str | None:
    """Path to the PINNED validation/snapshots/verdict_holdout_*.json, or None if
    the pinned file is absent (honest — never silently substitutes another)."""
    path = os.path.join(_SNAPSHOT_DIR, _HOLDOUT_SNAPSHOT)
    return path if os.path.exists(path) else None


def _load_approved_withdrawn() -> tuple[list[str], list[str], str | None]:
    """(approved_smiles, withdrawn_smiles, snapshot_name) from the pinned hold-out."""
    path = _pinned_holdout_snapshot()
    if path is None:
        return [], [], None
    with open(path) as f:
        snap = json.load(f)
    approved, withdrawn = [], []
    for rec in snap.get("records", []):
        smi = rec.get("smiles")
        if not smi:
            continue
        if rec.get("status") == "approved":
            approved.append(smi)
        elif rec.get("status") == "withdrawn":
            withdrawn.append(smi)
    return approved, withdrawn, os.path.basename(path)


def _conformal_upper_quantile(neg_scores: np.ndarray, alpha: float) -> float:
    """Split-conformal (1-α) quantile with finite-sample correction, mirroring
    models.conformal.conformal_quantile / ConformalVetoGate. +inf when too few."""
    s = np.sort(np.asarray(neg_scores, dtype=float).ravel())
    n = s.size
    if n == 0:
        return float("inf")
    rank = int(np.ceil((n + 1) * (1.0 - alpha)))
    if rank > n:
        return float("inf")
    return float(s[rank - 1])


def fit_approved_veto_screen(
    score_batch: Callable[[list[str]], np.ndarray],
    veto_alpha: float = _ISO_VETO_ALPHA,
    watch_alpha: float = _WATCH_ALPHA,
) -> dict[str, Any]:
    """Fit the FPR-controlled veto (NO-GO) + screen (WATCH) on the CALIBRATED
    approved-drug hold-out, so both operate on the served probability scale with a
    controlled false-positive rate on real marketed drugs.

    `score_batch(smiles) -> np.ndarray` must return SERVED (calibrated) scores for
    the parseable SMILES. Returns bundle fields including realised FPR-on-approved
    and recall-on-withdrawn (honest proof), or a not-calibrated marker when the
    snapshot is missing / too small.
    """
    approved_smiles, withdrawn_smiles, snap = _load_approved_withdrawn()
    if not approved_smiles:
        return {
            "veto_threshold": None,
            "veto_alpha": veto_alpha,
            "screen_threshold": None,
            "veto_calibration_population": None,
            "veto_calibration_status": "no_holdout_snapshot",
        }
    ap = np.asarray(score_batch(approved_smiles), dtype=float)
    ap = ap[np.isfinite(ap)]
    wd = np.asarray(score_batch(withdrawn_smiles), dtype=float) if withdrawn_smiles else np.empty(0)
    wd = wd[np.isfinite(wd)]
    if ap.size < 20:
        return {
            "veto_threshold": None,
            "veto_alpha": veto_alpha,
            "screen_threshold": None,
            "veto_calibration_population": snap,
            "veto_calibration_status": f"too_few_approved_scored:{ap.size}",
        }
    veto_thr = _conformal_upper_quantile(ap, veto_alpha)
    screen_thr = _conformal_upper_quantile(ap, watch_alpha)
    finite_v = np.isfinite(veto_thr)
    finite_s = np.isfinite(screen_thr)
    return {
        "veto_threshold": float(veto_thr) if finite_v else None,
        "veto_alpha": veto_alpha,
        "screen_threshold": float(screen_thr) if finite_s else None,
        "screen_alpha": watch_alpha,
        "veto_calibration_population": f"ChEMBL approved drugs (calibrated scale), snapshot={snap}",
        "veto_calibration_status": "CALIBRATED",
        "n_approved_scored": int(ap.size),
        "n_withdrawn_scored": int(wd.size),
        "veto_realised_fpr_on_approved": float(np.mean(ap > veto_thr)) if finite_v else 0.0,
        "veto_recall_on_withdrawn": (
            float(np.mean(wd > veto_thr)) if (finite_v and wd.size) else None
        ),
        "screen_realised_fpr_on_approved": float(np.mean(ap > screen_thr)) if finite_s else 0.0,
        "screen_recall_on_withdrawn": (
            float(np.mean(wd > screen_thr)) if (finite_s and wd.size) else None
        ),
    }


def _fit_isotonic_classification(
    spec: ModelSpec, model: Any, X: np.ndarray, y: np.ndarray
) -> dict[str, Any]:
    """Three-way fit/cal/test isotonic calibration (mirrors models/tox21_ml.py).

    Fits `model` on the fit split, an IsotonicRegression on the cal split, refits
    the conformal veto on the CALIBRATED cal-set inactive scores, and audits ECE /
    Brier (raw vs calibrated) on the untouched test split. Returns the bundle
    fields to merge, including the fitted RF under the private `_model` key.
    """
    from sklearn.isotonic import IsotonicRegression
    from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
    from sklearn.model_selection import train_test_split

    X_tmp, X_test, y_tmp, y_test = train_test_split(
        X, y, test_size=_ISO_TEST_FRACTION, random_state=_ISO_SEED, stratify=y
    )
    X_fit, X_cal, y_fit, y_cal = train_test_split(
        X_tmp,
        y_tmp,
        test_size=_ISO_CAL_FRACTION / (1.0 - _ISO_TEST_FRACTION),
        random_state=_ISO_SEED,
        stratify=y_tmp,
    )
    logger.info(
        "[%s] isotonic calibration: fit=%d cal=%d test=%d",
        spec.model_id,
        X_fit.shape[0],
        X_cal.shape[0],
        X_test.shape[0],
    )
    model.fit(X_fit, y_fit)

    raw_cal = positive_class_proba(model, X_cal)
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    iso.fit(raw_cal, y_cal)

    def _cal(Xin: np.ndarray) -> np.ndarray:
        return np.clip(iso.predict(positive_class_proba(model, Xin)), 0.0, 1.0)

    def _cal_smiles(smiles: list[str]) -> np.ndarray:
        Xa, _ = featurize_batch(smiles)
        return _cal(Xa) if Xa.shape[0] else np.empty(0)

    # Veto (NO-GO) + screen (WATCH): FPR-controlled conformal thresholds fitted on
    # the CALIBRATED approved-drug hold-out, so P(flag | approved) ≤ α on the served
    # scale. This is the safety guarantee that matters at runtime; the training-set
    # inactives are not exchangeable with approved drugs.
    gate_fields = fit_approved_veto_screen(_cal_smiles, veto_alpha=_ISO_VETO_ALPHA)

    raw_test = positive_class_proba(model, X_test)
    cal_test = _cal(X_test)
    both = len(set(y_test.tolist())) > 1
    return {
        "_model": model,
        "isotonic": iso,
        "calibration_method": "isotonic (three-way fit/cal/test)",
        "calibration_available": True,
        "n_train": int(X_fit.shape[0]),
        "n_calibration": int(X_cal.shape[0]),
        "n_cal_negatives": int((y_cal == 0).sum()),
        "n_test": int(X_test.shape[0]),
        "test_auroc": float(roc_auc_score(y_test, cal_test)) if both else None,
        "test_auprc": (
            float(average_precision_score(y_test, cal_test)) if y_test.sum() > 0 else None
        ),
        "brier_test": float(brier_score_loss(y_test, cal_test)),
        "brier_test_raw": float(brier_score_loss(y_test, raw_test)),
        "ece_test": expected_calibration_error(y_test, cal_test, n_bins=10),
        "ece_test_raw": expected_calibration_error(y_test, raw_test, n_bins=10),
        **gate_fields,
    }


def calibration_block(bundle: dict[str, Any]) -> dict[str, Any]:
    """Response `calibration` sub-block describing an isotonic-calibrated bundle,
    or an honest availability=False block for an uncalibrated one."""
    if bundle.get("isotonic") is None:
        return {
            "available": False,
            "reason": "bundle carries no calibrator (uncalibrated endpoint)",
        }
    return {
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


def train(spec: ModelSpec) -> dict[str, Any]:
    """Train the model described by `spec` and persist the bundle."""
    from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
    from sklearn.model_selection import cross_val_score

    logger.info("[%s] loading vendored TDC file %s ...", spec.model_id, spec.tdc_file)
    smiles, y_raw = load_tdc_tab(spec.tdc_file, spec.smiles_col, spec.label_col, spec.row_filter)
    if spec.prep_labels is not None:
        y_raw = spec.prep_labels(np.asarray(y_raw))
        if len(y_raw) != len(smiles):
            raise ValueError(
                f"[{spec.model_id}] prep_labels changed row count "
                f"({len(smiles)} → {len(y_raw)}); it must be elementwise"
            )

    logger.info("[%s] featurizing %d compounds...", spec.model_id, len(smiles))
    X, kept = featurize_batch(smiles)
    y = np.asarray(y_raw)[kept]
    logger.info(
        "[%s] %d compounds featurized (%d skipped)",
        spec.model_id,
        len(kept),
        len(smiles) - len(kept),
    )

    if spec.task == "classification":
        model = RandomForestClassifier(
            n_estimators=300,
            max_depth=None,
            min_samples_leaf=2,
            n_jobs=1,
            random_state=42,
            class_weight="balanced",
        )
        cv_scoring = "roc_auc"
    else:
        model = RandomForestRegressor(
            n_estimators=300,
            max_depth=None,
            min_samples_leaf=2,
            n_jobs=1,
            random_state=42,
        )
        cv_scoring = "r2"

    logger.info("[%s] running 5-fold CV (%s)...", spec.model_id, cv_scoring)
    cv_mean: float | None
    cv_std: float | None
    try:
        y_for_cv = y.astype(int) if spec.task == "classification" else y.astype(float)
        scores = cross_val_score(model, X, y_for_cv, cv=5, scoring=cv_scoring, n_jobs=1)
        cv_mean = float(np.mean(scores))
        cv_std = float(np.std(scores))
    except Exception as exc:  # noqa: BLE001
        logger.warning("[%s] CV failed (%s); proceeding without metric", spec.model_id, exc)
        cv_mean = None
        cv_std = None

    cal_fields: dict[str, Any] = {}
    if spec.task == "classification" and spec.calibrate_isotonic:
        # Opt-in isotonic calibration path — mirrors models/tox21_ml.py.
        cal_fields = _fit_isotonic_classification(spec, model, X, y.astype(int))
        model = cal_fields.pop("_model")  # RF fitted on the fit split only
    else:
        logger.info("[%s] fitting final model on full training set...", spec.model_id)
        if spec.task == "classification":
            model.fit(X, y.astype(int))
        else:
            model.fit(X, y.astype(float))

    training_fps = X[:, :MORGAN_NBITS].astype(np.float32)

    bundle: dict[str, Any] = {
        "version": spec.version,
        "model": model,
        "task": spec.task,
        "n_train": int(cal_fields.get("n_train", len(kept))),
        "cv_metric": cv_scoring,
        "cv_mean": cv_mean,
        "cv_std": cv_std,
        "morgan_nbits": MORGAN_NBITS,
        "morgan_radius": MORGAN_RADIUS,
        "feature_dim": int(X.shape[1]),
        "trained_at": time.time(),
        "training_fps": training_fps,
        **cal_fields,
    }
    if spec.task == "classification":
        pos = int(np.asarray(y).astype(int).sum())
        bundle["n_positives"] = pos
        bundle["n_negatives"] = int(len(kept) - pos)
    else:
        bundle["label_mean"] = float(np.mean(y.astype(float)))
        bundle["label_std"] = float(np.std(y.astype(float)))

    os.makedirs(CACHE_DIR, exist_ok=True)
    path = _cache_path(spec)
    with open(path, "wb") as f:
        pickle.dump(bundle, f)
    logger.info(
        "[%s] cached to %s (CV %s = %s ± %s)",
        spec.model_id,
        path,
        cv_scoring,
        f"{cv_mean:.3f}" if cv_mean is not None else "n/a",
        f"{cv_std:.3f}" if cv_std is not None else "n/a",
    )
    return bundle


# --------------------------------------------------------------------------- #
# Singleton loader
# --------------------------------------------------------------------------- #


class _State:
    """Per-model in-memory state (bundle + load metadata)."""

    def __init__(self) -> None:
        self.model: dict[str, Any] | None = None
        self.load_time_s: float | None = None
        self.error: str | None = None
        self.lock = threading.Lock()


_STATES: dict[str, _State] = {}


def _state(spec: ModelSpec) -> _State:
    st = _STATES.get(spec.model_id)
    if st is None:
        st = _State()
        _STATES[spec.model_id] = st
    return st


def load(spec: ModelSpec) -> dict[str, Any]:
    """Singleton loader — trains on first call if no cache exists."""
    st = _state(spec)
    if st.model is not None:
        return st.model
    with st.lock:
        if st.model is not None:
            return st.model
        try:
            t0 = time.time()
            path = _cache_path(spec)
            if os.path.exists(path):
                with open(path, "rb") as f:
                    bundle = pickle.load(f)
                if bundle.get("version") != spec.version:
                    logger.info("[%s] cache version mismatch, retraining", spec.model_id)
                    bundle = train(spec)
            else:
                logger.info("[%s] no cache found, training from scratch", spec.model_id)
                bundle = train(spec)
            st.model = bundle
            st.load_time_s = time.time() - t0
            logger.info("[%s] ready in %.2fs", spec.model_id, st.load_time_s)
            return bundle
        except Exception as exc:  # noqa: BLE001
            st.error = f"{type(exc).__name__}: {exc}"
            logger.exception("[%s] failed to load/train", spec.model_id)
            raise


def status(spec: ModelSpec) -> dict[str, Any]:
    st = _state(spec)
    return {
        "loaded": st.model is not None,
        "load_time_s": st.load_time_s,
        "error": st.error,
        "engine": spec.title,
        "metrics": (
            {
                k: st.model.get(k)
                for k in (
                    "n_train",
                    "n_positives",
                    "n_negatives",
                    "label_mean",
                    "label_std",
                    "cv_metric",
                    "cv_mean",
                    "cv_std",
                    "trained_at",
                    "version",
                )
                if k in st.model
            }
            if st.model is not None
            else {}
        ),
    }


def warmup(spec: ModelSpec) -> dict[str, Any]:
    """Force load/train — used by /models/warmup + startup prewarm threads."""
    try:
        load(spec)
        return {"status": "ready", **status(spec)}
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "error": str(exc), **status(spec)}


# --------------------------------------------------------------------------- #
# Inference helpers
# --------------------------------------------------------------------------- #


def fallback_envelope(spec: ModelSpec, smiles: str, error: str) -> dict[str, Any]:
    """Standard NO-fake fallback envelope. ml_available=False + explicit error."""
    return {
        "smiles": smiles,
        "source": "fallback",
        "ml_available": False,
        "error": error,
        "model_info": {
            "engine": f"{spec.title} (unavailable)",
            "method": spec.method,
            "dataset": spec.dataset_ref,
            "load_status": status(spec),
        },
    }


def predict_classification_probability(
    spec: ModelSpec, smiles: str
) -> tuple[float, float, np.ndarray, dict[str, Any]] | dict[str, Any]:
    """Run a classifier and return (served_probability, raw_probability,
    feature_vec, bundle) on success, or a fallback envelope on failure.

    `raw_probability` is the RF positive-class score; `served_probability` is the
    isotonic-calibrated value when the bundle carries a calibrator (opt-in via
    ModelSpec.calibrate_isotonic), else identical to the raw score.
    """
    if not smiles or not smiles.strip():
        raise ValueError("smiles is required")

    canon = canonicalize(smiles.strip())
    if canon is None:
        return fallback_envelope(spec, smiles, "rdkit_could_not_parse_smiles")
    try:
        bundle = load(spec)
    except Exception as exc:  # noqa: BLE001
        return fallback_envelope(spec, canon, f"model_load_failed: {exc}")

    feats = featurize(canon)
    if feats is None:
        return fallback_envelope(spec, canon, "rdkit_could_not_parse_smiles")

    try:
        clf = bundle["model"]
        proba = clf.predict_proba(feats.reshape(1, -1))[0]
        classes = list(clf.classes_)
        # Probability of positive class (class 1). Fall back to the last column
        # only when the model saw both classes in training; a single-class model
        # is treated as a hard failure to avoid a silent 100%/0% answer.
        if 1 in classes:
            raw_prob = float(proba[classes.index(1)])
        elif len(classes) == 1:
            return fallback_envelope(
                spec,
                canon,
                f"model_saw_only_one_class:{classes[0]!r} — cannot output probability",
            )
        else:
            raw_prob = float(proba[-1])
        iso = bundle.get("isotonic")
        served_prob = (
            float(np.clip(iso.predict([raw_prob])[0], 0.0, 1.0)) if iso is not None else raw_prob
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("[%s] inference failed for SMILES=%r", spec.model_id, canon)
        return fallback_envelope(spec, canon, f"inference_failed: {exc}")

    return served_prob, raw_prob, feats, bundle


def predict_regression_value(
    spec: ModelSpec, smiles: str
) -> tuple[float, np.ndarray, dict[str, Any]] | dict[str, Any]:
    """Run a regressor and return (value, feature_vec, bundle) on success."""
    if not smiles or not smiles.strip():
        raise ValueError("smiles is required")

    canon = canonicalize(smiles.strip())
    if canon is None:
        return fallback_envelope(spec, smiles, "rdkit_could_not_parse_smiles")
    try:
        bundle = load(spec)
    except Exception as exc:  # noqa: BLE001
        return fallback_envelope(spec, canon, f"model_load_failed: {exc}")

    feats = featurize(canon)
    if feats is None:
        return fallback_envelope(spec, canon, "rdkit_could_not_parse_smiles")

    try:
        reg = bundle["model"]
        value = float(reg.predict(feats.reshape(1, -1))[0])
    except Exception as exc:  # noqa: BLE001
        logger.exception("[%s] inference failed for SMILES=%r", spec.model_id, canon)
        return fallback_envelope(spec, canon, f"inference_failed: {exc}")

    return value, feats, bundle


# --------------------------------------------------------------------------- #
# Conformal prediction intervals (regression endpoints)
# --------------------------------------------------------------------------- #

CONFORMAL_INTERVALS_PATH = os.path.join(CACHE_DIR, "conformal_regression_intervals.json")
_conformal_intervals_cache: dict[str, Any] | None = None
_conformal_intervals_mtime: float | None = None


def _load_conformal_intervals() -> dict[str, Any]:
    """Load `cache/conformal_regression_intervals.json`, produced offline by
    `scripts/calibrate_regression_conformal.py` (5-fold cross-conformal
    calibration; see that script's docstring for full methodology + the
    train/test-leakage finding that motivated the cross-conformal approach
    over textbook single-split conformal). Re-reads the file if it changes on
    disk (e.g. after a recalibration run) rather than caching forever."""
    global _conformal_intervals_cache, _conformal_intervals_mtime
    try:
        mtime = os.path.getmtime(CONFORMAL_INTERVALS_PATH)
    except OSError:
        return {}
    if _conformal_intervals_cache is None or mtime != _conformal_intervals_mtime:
        with open(CONFORMAL_INTERVALS_PATH) as f:
            _conformal_intervals_cache = json.load(f)
        _conformal_intervals_mtime = mtime
    return _conformal_intervals_cache


def conformal_interval(endpoint_key: str, point_estimate: float) -> dict[str, Any]:
    """Attach a calibrated conformal interval to a point estimate.

    Returns a `{ci_low, ci_high, confidence_level, method, n_calibration,
    realised_coverage}` block when `endpoint_key` has a real calibration on
    disk, or an honest `{ci_low: None, ...}` "not calibrated" block otherwise
    — NEVER a fabricated width. Callers must not treat a null ci_low/ci_high
    as "no uncertainty"; it means calibration hasn't been run for this
    endpoint yet.
    """
    calib = _load_conformal_intervals().get(endpoint_key)
    if not calib or calib.get("status") != "CALIBRATED":
        return {
            "ci_low": None,
            "ci_high": None,
            "confidence_level": None,
            "method": "not calibrated — run scripts/calibrate_regression_conformal.py for this endpoint",
        }
    q = float(calib["half_width_q"])
    return {
        "ci_low": round(point_estimate - q, 4),
        "ci_high": round(point_estimate + q, 4),
        "confidence_level": calib.get("confidence_level"),
        "method": calib.get("method"),
        "n_calibration": calib.get("n_calibration"),
        "realised_coverage": calib.get("realised_coverage_holdout_resplit"),
    }


# --------------------------------------------------------------------------- #
# Conformal veto gate (classification endpoints) — FPR-controlled hard threshold
# --------------------------------------------------------------------------- #

CONFORMAL_VETO_PATH = str(resolve_artifact("conformal_calibration.json"))
_conformal_veto_cache: dict[str, Any] | None = None
_conformal_veto_mtime: float | None = None


def _load_conformal_veto() -> dict[str, Any]:
    """Load `cache/conformal_calibration.json`, produced offline by
    `scripts/calibrate_conformal_thresholds.py`. Each endpoint's threshold is the
    split-conformal (1-α) quantile of the in-domain APPROVED-drug liability scores
    (`models.conformal.ConformalVetoGate`), so P(flag | approved drug) ≤ α by
    construction — a principled replacement for a hand-picked cutoff. Re-reads the
    file if it changes on disk (e.g. after recalibration)."""
    global _conformal_veto_cache, _conformal_veto_mtime
    try:
        mtime = os.path.getmtime(CONFORMAL_VETO_PATH)
    except OSError:
        return {}
    if _conformal_veto_cache is None or mtime != _conformal_veto_mtime:
        with open(CONFORMAL_VETO_PATH) as f:
            _conformal_veto_cache = json.load(f)
        _conformal_veto_mtime = mtime
    return _conformal_veto_cache


def conformal_veto(endpoint_key: str, probability: float) -> dict[str, Any]:
    """Apply the FPR-controlled conformal veto threshold to a classifier score.

    `endpoint_key` indexes `conformal_calibration.json["endpoints"]`
    (e.g. "herg", "dili", "ames"). Returns a block reporting whether the score
    trips the calibrated hard-veto threshold, together with the guarantee it
    carries (α) and the FPR it actually realised on a held-out approved-drug set.

    When the endpoint is not calibrated, returns an honest `{calibrated: False,
    flag: None, ...}` block — the caller MUST NOT treat that as "safe"; it means
    the FPR-controlled gate has not been fitted for this endpoint yet. The flag
    uses the same STRICT `>` rule as `ConformalVetoGate.flag`, so the reported
    FPR guarantee holds even under score ties.
    """
    root = _load_conformal_veto()
    calib = (root.get("endpoints") or {}).get(endpoint_key)
    if not calib or calib.get("status") != "CALIBRATED":
        return {
            "calibrated": False,
            "flag": None,
            "method": "not calibrated — run scripts/calibrate_conformal_thresholds.py for this endpoint",
        }
    thr = float(calib["threshold"])
    return {
        "calibrated": True,
        "flag": bool(probability > thr),
        "threshold": round(thr, 4),
        "alpha": calib.get("alpha", root.get("alpha")),
        "realised_fpr_on_approved": calib.get("realised_fpr_on_approved_holdout_resplit"),
        "recall_on_withdrawn_in_domain": calib.get("recall_on_withdrawn_in_domain"),
        "n_calibration_approved": calib.get("n_calibration_in_domain_approved"),
        "method": (
            "split-conformal (1-α) quantile of in-domain approved-drug scores "
            "(models.conformal.ConformalVetoGate) — P(flag | approved) ≤ α"
        ),
        "interpretation": (
            f"flag=true means P(active)={round(probability, 4)} exceeds the α="
            f"{calib.get('alpha', root.get('alpha'))} FPR-controlled threshold "
            f"{round(thr, 4)}; a hard safety alert may fire ONLY when this flag is "
            "true AND the endpoint is in-domain and uncontradicted."
        ),
    }


# --------------------------------------------------------------------------- #
# Honest scaffold-split held-out performance (classification safety endpoints)
# --------------------------------------------------------------------------- #

SCAFFOLD_METRICS_PATH = str(resolve_artifact("classification_scaffold_metrics.json"))
_scaffold_metrics_cache: dict[str, Any] | None = None
_scaffold_metrics_mtime: float | None = None


def _load_scaffold_metrics() -> dict[str, Any]:
    """Load `cache/classification_scaffold_metrics.json`, produced offline by
    `scripts/evaluate_scaffold_holdout.py` (Bemis-Murcko scaffold split — the
    realistic novel-chemistry generalization number, immune to the train/test
    leakage in the vendored full-release .tab files)."""
    global _scaffold_metrics_cache, _scaffold_metrics_mtime
    try:
        mtime = os.path.getmtime(SCAFFOLD_METRICS_PATH)
    except OSError:
        return {}
    if _scaffold_metrics_cache is None or mtime != _scaffold_metrics_mtime:
        with open(SCAFFOLD_METRICS_PATH) as f:
            _scaffold_metrics_cache = json.load(f)
        _scaffold_metrics_mtime = mtime
    return _scaffold_metrics_cache


SCREENING_PATH = str(resolve_artifact("screening_thresholds.json"))
_screening_cache: dict[str, Any] | None = None
_screening_mtime: float | None = None


def _load_screening() -> dict[str, Any]:
    """Load `cache/screening_thresholds.json` (Youden-J + recall-target operating
    points on the real ChEMBL approved/withdrawn hold-out), produced by
    `scripts/calibrate_screening_thresholds.py`."""
    global _screening_cache, _screening_mtime
    try:
        mtime = os.path.getmtime(SCREENING_PATH)
    except OSError:
        return {}
    if _screening_cache is None or mtime != _screening_mtime:
        with open(SCREENING_PATH) as f:
            _screening_cache = json.load(f)
        _screening_mtime = mtime
    return _screening_cache


def screening_flag(
    endpoint_key: str, probability: float, operating_point: str = "fpr_controlled"
) -> dict[str, Any]:
    """Apply the WATCH-gate threshold (complement to the high-specificity conformal
    veto). `operating_point` ∈ {"fpr_controlled", "youden", "recall_target"}.

    Default is "fpr_controlled": an FPR-controlled WATCH threshold (P(WATCH|approved)
    ≤ α, α=0.20) — flags only the top ~20% of approved-drug scores. This replaces the
    old Youden-J default, which maximised raw sensitivity at an uncontrolled ~60%
    approved-drug FPR and therefore demoted most SAFE drugs to WATCH. Returns the flag
    plus the realised recall/FPR the threshold achieved on the real approved/withdrawn
    hold-out. Honest not-calibrated block when the endpoint has no screen."""
    calib = (_load_screening().get("endpoints") or {}).get(endpoint_key)
    if not calib or calib.get("status") != "CALIBRATED":
        return {
            "calibrated": False,
            "flag": None,
            "method": "not calibrated — run scripts/calibrate_screening_thresholds.py",
        }
    block_key = {
        "fpr_controlled": "screen_fpr_controlled",
        "youden": "screen_youden",
        "recall_target": "screen_recall_target",
    }.get(operating_point, "screen_fpr_controlled")
    op = calib.get(block_key)
    if not op:  # requested operating point missing → fall back to Youden (always present)
        op = calib.get("screen_youden") or {}
    thr = float(op["threshold"])
    return {
        "calibrated": True,
        "operating_point": operating_point,
        "flag": bool(probability > thr),
        "threshold": round(thr, 4),
        "recall_withdrawn": op.get("recall_withdrawn"),
        "fpr_approved": op.get("fpr_approved", op.get("realised_fpr_approved")),
        "method": op.get("basis"),
        "interpretation": (
            f"Sensitivity screen: P(active)={round(probability, 4)} vs screen threshold "
            f"{round(thr, 4)} (catches {op.get('recall_withdrawn')} of withdrawn drugs at "
            f"{op.get('fpr_approved')} approved-FPR). A screen hit means 'review/confirm', "
            "not a hard NO-GO."
        ),
    }


def scaffold_metrics(endpoint_key: str) -> dict[str, Any] | None:
    """Return the honest scaffold-split held-out metrics for `endpoint_key`
    (e.g. "herg", "dili", "ames"), or None when not evaluated. Callers surface
    this as `heldout_performance_scaffold` so the reported performance is the
    leakage-free generalization number, not the optimistic in-release CSV."""
    return (_load_scaffold_metrics().get("endpoints") or {}).get(endpoint_key)


def model_info_block(
    spec: ModelSpec, bundle: dict[str, Any], inference_ms: float
) -> dict[str, Any]:
    """Standard `model_info` payload for the response envelope."""
    perf: dict[str, Any] = {
        "cv_metric": bundle.get("cv_metric"),
        "cv_mean": bundle.get("cv_mean"),
        "cv_std": bundle.get("cv_std"),
        "cv_folds": 5,
    }
    training: dict[str, Any] = {
        "dataset": spec.dataset_ref,
        "n_train": bundle.get("n_train"),
    }
    if spec.task == "classification":
        training["n_positives"] = bundle.get("n_positives")
        training["n_negatives"] = bundle.get("n_negatives")
    else:
        training["label_mean"] = bundle.get("label_mean")
        training["label_std"] = bundle.get("label_std")
        training["label_units"] = spec.label_units
    return {
        "engine": spec.title,
        "method": spec.method,
        "training": training,
        "performance": perf,
        "features": {
            "morgan_nbits": bundle.get("morgan_nbits"),
            "morgan_radius": bundle.get("morgan_radius"),
            "rdkit_descriptors": DESCRIPTOR_NAMES,
        },
        "inference_time_ms": inference_ms,
        "license": "MIT (HakaseAI internal); training data CC-BY 4.0 (TDC)",
    }
