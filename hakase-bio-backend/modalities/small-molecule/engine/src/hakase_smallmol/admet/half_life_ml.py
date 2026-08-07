"""HalfLife-ML — terminal plasma half-life (hours) regressor.

Half-life sets dosing frequency and time-to-steady-state, and is the PK number
clinicians reason about most directly.

Methodology:
  1. Public training data: TDC `Half_Life_Obach` (Obach et al., Drug Metab.
     Dispos. 2008; 667 compounds, human IV data). CC-BY 4.0 via Therapeutics
     Data Commons.
  2. Feature representation: Morgan (1024-bit, radius 2) + 6 RDKit descriptors.
  3. Algorithm: sklearn Random Forest Regressor (300 trees, deterministic
     n_jobs=1), trained on **log10(t½)**. CV R² is reported in log space.

WHY LOG SPACE:
  Raw half-life spans 0.065 - 1,200 h with a skew of ~10 — see the identical
  rationale in `vdss_ml.py`. The conformal interval is symmetric in log space
  and therefore ASYMMETRIC once back-transformed to hours; `half_life_hours`
  is a log-space median, not a mean.

HONEST SCOPE:
  * Predicts:  human terminal plasma half-life, hours.
  * Does NOT predict: distribution vs elimination phase half-lives separately.
  * SMALL TRAINING SET (667 compounds) and half-life is a *derived* composite of
    clearance and volume, so it is intrinsically harder to predict than either.
    Expect wide intervals; treat this as order-of-magnitude triage, and prefer
    reasoning from the VDss and clearance heads where both are in-domain.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import hakase_kernel.base as base
import numpy as np

logger = logging.getLogger(__name__)


def _to_log10(y: np.ndarray) -> np.ndarray:
    """log10 the raw hour labels; fail loudly on non-positive values."""
    y = np.asarray(y, dtype=float)
    if not np.all(y > 0):
        bad = int((y <= 0).sum())
        raise ValueError(
            f"half_life_ml: {bad} non-positive half-life label(s) cannot be log10-transformed"
        )
    return np.log10(y)


SPEC = base.ModelSpec(
    model_id="half_life_ml",
    version="1.0.0",
    tdc_file="half_life_obach.tab",
    task="regression",
    smiles_col="X",
    label_col="Y",
    prep_labels=_to_log10,
    label_units="log10(half-life in hours)",
    title="HalfLife-ML v1 (Random Forest, Morgan FP + RDKit descriptors, log10 target)",
    method="Independent second-opinion terminal half-life regressor trained on TDC Half_Life_Obach (log10 target)",
    dataset_ref="TDC Half_Life_Obach (Obach et al., Drug Metab. Dispos., 2008)",
)


def is_ready() -> dict[str, Any]:
    return base.status(SPEC)


def warmup() -> dict[str, Any]:
    return base.warmup(SPEC)


def _half_life_band(hours: float) -> str:
    """Dosing-oriented bands for terminal half-life.

    < 3    → Short      (likely BID/TID or a sustained-release formulation)
    3-12   → Moderate   (compatible with BID)
    12-24  → Long       (compatible with QD)
    > 24   → Very long  (QD+; accumulation and long washout to consider)
    """
    if hours < 3.0:
        return "Short"
    if hours <= 12.0:
        return "Moderate"
    if hours <= 24.0:
        return "Long"
    return "Very long"


def predict_half_life_ml(smiles: str) -> dict[str, Any]:
    t0 = time.time()
    result = base.predict_regression_value(SPEC, smiles)
    if isinstance(result, dict):
        return result
    log_value, feats, bundle = result
    inference_ms = round((time.time() - t0) * 1000, 2)
    ad = base.compute_ad(bundle, feats)

    hours = float(10.0**log_value)

    ci = base.conformal_interval("half_life_log10_hours", log_value)
    ci_block = dict(ci)
    if ci["ci_low"] is not None:
        ci_block["ci_low_hours"] = float(10.0 ** ci["ci_low"])
        ci_block["ci_high_hours"] = float(10.0 ** ci["ci_high"])

    return {
        "smiles": base.canonicalize(smiles.strip()) or smiles,
        "source": "ml",
        "ml_available": True,
        "prediction": {
            "log10_half_life_hours": log_value,
            "half_life_hours": hours,
            "half_life_class": _half_life_band(hours),
            "units": "half_life_hours = 10^log10_half_life_hours, in hours (log-space median)",
        },
        "conformal_interval": ci_block,
        "applicability_domain": base.ad_envelope(ad),
        "model_info": base.model_info_block(SPEC, bundle, inference_ms),
    }
