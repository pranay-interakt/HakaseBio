"""Caco2-ML — Caco-2 cell monolayer apparent permeability (log Papp) regressor.

Independent single-endpoint continuous permeability regressor. Caco-2 is the
industry-standard in vitro absorption model; a real log Papp prediction
complements the binary HIA classifier and the PAMPA rule surface for a
defensible Layer 1 absorption story.

Methodology:
  1. Public training data: TDC `Caco2_Wang` (Wang et al., ADMET & DMPK, 2016,
     ~910 compounds; continuous log Papp in cm/s at 10⁻⁶ scale).
     CC-BY 4.0 via Therapeutics Data Commons.
  2. Feature representation: Morgan (1024-bit, radius 2) + 6 RDKit descriptors.
  3. Algorithm: sklearn Random Forest Regressor (300 trees, deterministic
     n_jobs=1). CV R² reported honestly.

HONEST SCOPE:
  * Predicts:  continuous log Papp (log₁₀ cm/s × 10⁻⁶) + qualitative band.
  * Does NOT predict: efflux ratio B→A / A→B — that requires paired-direction
    Caco-2 measurements not present in the TDC training corpus.
  * Does NOT distinguish: passive vs transporter-mediated permeability.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import hakase_kernel.base as base

logger = logging.getLogger(__name__)

SPEC = base.ModelSpec(
    model_id="caco2_ml",
    version="1.0.0",
    tdc_file="caco2_wang.tab",
    task="regression",
    title="Caco2-ML v1 (Random Forest, Morgan FP + RDKit descriptors)",
    method="Independent second-opinion Caco-2 log Papp regressor trained on TDC Caco2_Wang",
    dataset_ref="TDC Caco2_Wang (Wang et al., ADMET & DMPK, 2016)",
)


def warmup() -> dict[str, Any]:
    return base.warmup(SPEC)


def _permeability_band(log_papp: float) -> str:
    """Standard Caco-2 permeability triage bands used by pharma DMPK groups.

    Cutoffs on log Papp (log₁₀ cm/s × 10⁻⁶):
      >  -5.15 → High permeability   (Papp > ~7 × 10⁻⁶ cm/s)
      >  -5.70 → Moderate            (~2–7 × 10⁻⁶ cm/s)
      else    → Low                  (< ~2 × 10⁻⁶ cm/s)
    """
    if log_papp > -5.15:
        return "High"
    if log_papp > -5.70:
        return "Moderate"
    return "Low"


def predict_caco2_ml(smiles: str) -> dict[str, Any]:
    t0 = time.time()
    result = base.predict_regression_value(SPEC, smiles)
    if isinstance(result, dict):
        return result
    value, feats, bundle = result
    inference_ms = round((time.time() - t0) * 1000, 2)
    ad = base.compute_ad(bundle, feats)

    ci = base.conformal_interval("caco2_log_papp", value)
    ci_block = dict(ci)
    if ci["ci_low"] is not None:
        ci_block["ci_low_papp_cm_per_s"] = pow(10.0, ci["ci_low"])
        ci_block["ci_high_papp_cm_per_s"] = pow(10.0, ci["ci_high"])

    return {
        "smiles": base.canonicalize(smiles.strip()) or smiles,
        "source": "ml",
        "ml_available": True,
        "prediction": {
            "log_papp": value,
            "papp_cm_per_s": pow(10.0, value),
            "permeability_class": _permeability_band(value),
            "units": "log10(cm/s), i.e. log_Papp — multiply 10^value to get cm/s",
        },
        "conformal_interval": ci_block,
        "applicability_domain": base.ad_envelope(ad),
        "model_info": base.model_info_block(SPEC, bundle, inference_ms),
    }
