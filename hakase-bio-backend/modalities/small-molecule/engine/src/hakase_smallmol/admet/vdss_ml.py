"""VDss-ML — steady-state volume of distribution (L/kg) regressor.

VDss describes how extensively a drug partitions out of plasma into tissue. It
is one of the two terms that set half-life (t½ ≈ 0.693 · VDss / CL), and it
drives loading-dose choice.

Methodology:
  1. Public training data: TDC `VDss_Lombardo` (Lombardo & Jing, J. Chem. Inf.
     Model. 2016; 1,130 compounds, human IV data). CC-BY 4.0 via Therapeutics
     Data Commons.
  2. Feature representation: Morgan (1024-bit, radius 2) + 6 RDKit descriptors.
  3. Algorithm: sklearn Random Forest Regressor (300 trees, deterministic
     n_jobs=1), trained on **log10(VDss)**. CV R² is reported in log space.

WHY LOG SPACE:
  Raw VDss spans 0.01 - 700 L/kg with a skew of ~27. Fitting squared error on
  that raw scale lets a handful of very-high-VDss compounds (e.g. chloroquine)
  dominate the loss, and lets the model emit physically impossible negative
  volumes. Training on log10 makes the target roughly symmetric, makes the
  error multiplicative (which is how VDss is actually reasoned about — "within
  2-fold"), and makes negative predictions structurally impossible after the
  10**x back-transform.

  Consequence to read carefully: the conformal interval is calibrated in LOG
  space and is symmetric there, so the back-transformed interval on L/kg is
  ASYMMETRIC. `vdss_l_per_kg` is the back-transform of the log-space point
  estimate (a median, not a mean) — do not average these values on the linear
  scale.

HONEST SCOPE:
  * Predicts:  human steady-state volume of distribution, L/kg.
  * Does NOT predict: tissue-specific partitioning (Kp) or Vc/Vp of a
    multi-compartment model.
  * Trained on IV human data only — it says nothing about oral absorption.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import hakase_kernel.base as base
import numpy as np

logger = logging.getLogger(__name__)


def _to_log10(y: np.ndarray) -> np.ndarray:
    """log10 the raw L/kg labels. Fails loudly on non-positive values rather
    than emitting -inf/NaN into the RF (which would poison training silently)."""
    y = np.asarray(y, dtype=float)
    if not np.all(y > 0):
        bad = int((y <= 0).sum())
        raise ValueError(f"vdss_ml: {bad} non-positive VDss label(s) cannot be log10-transformed")
    return np.log10(y)


SPEC = base.ModelSpec(
    model_id="vdss_ml",
    version="1.0.0",
    tdc_file="vdss_lombardo.tab",
    task="regression",
    smiles_col="X",
    label_col="Y",
    prep_labels=_to_log10,
    label_units="log10(VDss in L/kg)",
    title="VDss-ML v1 (Random Forest, Morgan FP + RDKit descriptors, log10 target)",
    method="Independent second-opinion steady-state volume-of-distribution regressor trained on TDC VDss_Lombardo (log10 target)",
    dataset_ref="TDC VDss_Lombardo (Lombardo & Jing, J. Chem. Inf. Model., 2016)",
)


def is_ready() -> dict[str, Any]:
    return base.status(SPEC)


def warmup() -> dict[str, Any]:
    return base.warmup(SPEC)


def _vdss_band(vdss: float) -> str:
    """Standard clinical-pharmacology bands for VDss (L/kg).

    < 0.7  → Low        (largely confined to plasma/extracellular water)
    0.7-3  → Moderate   (distributes into total body water)
    > 3    → High       (extensive tissue partitioning)
    """
    if vdss < 0.7:
        return "Low"
    if vdss <= 3.0:
        return "Moderate"
    return "High"


def predict_vdss_ml(smiles: str) -> dict[str, Any]:
    t0 = time.time()
    result = base.predict_regression_value(SPEC, smiles)
    if isinstance(result, dict):
        return result
    log_value, feats, bundle = result
    inference_ms = round((time.time() - t0) * 1000, 2)
    ad = base.compute_ad(bundle, feats)

    vdss = float(10.0**log_value)

    ci = base.conformal_interval("vdss_log10_l_per_kg", log_value)
    ci_block = dict(ci)
    if ci["ci_low"] is not None:
        # Back-transform the log-space bounds. Asymmetric on the linear scale
        # by construction — see WHY LOG SPACE in the module docstring.
        ci_block["ci_low_l_per_kg"] = float(10.0 ** ci["ci_low"])
        ci_block["ci_high_l_per_kg"] = float(10.0 ** ci["ci_high"])

    return {
        "smiles": base.canonicalize(smiles.strip()) or smiles,
        "source": "ml",
        "ml_available": True,
        "prediction": {
            "log10_vdss": log_value,
            "vdss_l_per_kg": vdss,
            "distribution_class": _vdss_band(vdss),
            "units": "vdss_l_per_kg = 10^log10_vdss, in L/kg (log-space median)",
        },
        "conformal_interval": ci_block,
        "applicability_domain": base.ad_envelope(ad),
        "model_info": base.model_info_block(SPEC, bundle, inference_ms),
    }
