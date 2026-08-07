"""Ames-ML — bacterial reverse mutation (Ames test) mutagenicity classifier.

Independent single-endpoint second-opinion model for the Ames genotoxicity screen.
Every IND-enabling package needs an Ames screen; this model provides a real
probability so novel compounds get a defensible number in the L1 scorecard.

Methodology (identical family as `cardiotox.py` and `dili_ml.py`):
  1. Public training data: TDC `AMES` (Xu et al., J. Chem. Inf. Model., 2012,
     7278 compounds, binary "positive" = mutagenic to at least one Ames strain).
     CC-BY 4.0 via Therapeutics Data Commons.
  2. Feature representation: RDKit Morgan circular fingerprint (1024-bit,
     radius 2) + 6 physicochemical descriptors.
  3. Algorithm: sklearn Random Forest classifier (300 trees, class_weight=
     balanced, deterministic n_jobs=1).

HONEST SCOPE:
  * Predicts:  binary Ames-positive probability + qualitative risk class.
  * Does NOT predict: strain-specific mutagenicity (TA98 vs TA100 vs TA1535
    vs TA1537 vs TA102/WP2). The TDC AMES label is any-strain positive.
  * Does NOT predict: metabolic activation dependence (± S9 mix). The
    prediction reflects the mixed ± S9 training corpus.

Trains on first call from vendored `hakase_smallmol/data/ames.tab` (~10-20s
on typical CPU), caches the fitted pipeline as a pickle. Sub-50ms inference
after warm.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import hakase_kernel.base as base

logger = logging.getLogger(__name__)

# v1.1.0: isotonic probability calibration (three-way fit/cal/test) + conformal
# veto refitted on the calibrated cal-set scores, via the _ml_base opt-in flag.
# The served mutagenic_probability is now a calibrated probability, not a raw RF
# ranking score. Bumped so the cache retrains and persists the isotonic object.
SPEC = base.ModelSpec(
    model_id="ames_ml",
    version="1.1.0",
    tdc_file="ames.tab",
    task="classification",
    title="Ames-ML v1.1 (RF on Morgan FP + RDKit descriptors, isotonic-calibrated)",
    method="Independent second-opinion Ames mutagenicity classifier trained on TDC AMES (Xu et al., 2012); "
    "isotonic probability calibration + FPR-controlled conformal veto",
    dataset_ref="TDC AMES (Xu et al., J. Chem. Inf. Model., 2012)",
    calibrate_isotonic=True,
)


def is_ready() -> dict[str, Any]:
    return base.status(SPEC)


def warmup() -> dict[str, Any]:
    return base.warmup(SPEC)


def veto_gate() -> dict[str, Any]:
    """Bundle-stored conformal veto + screen thresholds, on the SERVED (calibrated)
    probability scale, so runtime consumers threshold the served
    mutagenic_probability on the same scale it is displayed. Loads/trains as needed."""
    bundle = base.load(SPEC)
    return {
        "endpoint": "ames",
        "calibrated": bundle.get("isotonic") is not None,
        "scale": "calibrated" if bundle.get("isotonic") is not None else "raw",
        "veto_threshold": bundle.get("veto_threshold"),
        "veto_alpha": bundle.get("veto_alpha"),
        "screen_threshold": bundle.get("screen_threshold"),
    }


def _risk_class(prob: float) -> str:
    """Standard pharma triage bands for Ames positivity."""
    if prob < 0.30:
        return "Low"
    if prob < 0.60:
        return "Moderate"
    return "High"


def predict_ames_ml(smiles: str) -> dict[str, Any]:
    """Predict Ames mutagenicity probability for one SMILES."""
    t0 = time.time()
    result = base.predict_classification_probability(SPEC, smiles)
    if isinstance(result, dict):
        # Fallback envelope
        return result
    prob, raw_prob, feats, bundle = result
    inference_ms = round((time.time() - t0) * 1000, 2)

    ad = base.compute_ad(bundle, feats)

    # Conformal veto on the CALIBRATED scale: prefer the bundle-stored threshold
    # (refitted on the calibrated cal-set inactives at train time) so the served
    # probability and the veto threshold are on the same scale. Fall back to the
    # legacy raw-scale artifact only for an uncalibrated bundle.
    veto_thr = bundle.get("veto_threshold")
    if bundle.get("isotonic") is not None and veto_thr is not None:
        import numpy as _np

        veto = {
            "calibrated": True,
            "flag": bool(_np.isfinite(veto_thr) and prob > veto_thr),
            "threshold": round(float(veto_thr), 4),
            "alpha": bundle.get("veto_alpha"),
            "scale": "calibrated probability (bundle-fitted on calibrated cal-set inactives)",
            "method": (
                "split-conformal (1-α) quantile of CALIBRATED cal-set inactive scores "
                "(models.conformal.ConformalVetoGate) — P(flag | inactive) ≤ α"
            ),
        }
    else:
        veto = base.conformal_veto("ames", prob)

    return {
        "smiles": base.canonicalize(smiles.strip()) or smiles,
        "source": "ml",
        "ml_available": True,
        "prediction": {
            "mutagenic_probability": prob,
            "mutagenic_probability_raw": raw_prob,
            "risk_class": _risk_class(prob),
            "label_convention": "positive = mutagenic to at least one Ames strain (± S9)",
            "calibration": base.calibration_block(bundle),
        },
        "applicability_domain": base.ad_envelope(ad),
        "conformal_veto": veto,
        "model_info": base.model_info_block(SPEC, bundle, inference_ms),
    }
