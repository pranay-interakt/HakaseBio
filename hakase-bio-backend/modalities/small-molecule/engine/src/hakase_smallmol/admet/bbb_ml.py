"""BBB-ML — blood-brain barrier penetration classifier.

Independent single-endpoint second-opinion model for BBB penetration. Critical
for CNS indications (Alzheimer's, Parkinson's, schizophrenia, glioma) where
central penetration is required, and equally important for peripheral drugs
where CNS penetration is undesired.

Methodology (identical family as `cardiotox.py`, `dili_ml.py`, `ames_ml.py`):
  1. Public training data: TDC `BBB_Martins` (Martins et al., J. Chem. Inf.
     Model., 2012, ~2030 compounds; binary "1" = permeable to CNS).
     CC-BY 4.0 via Therapeutics Data Commons.
  2. Feature representation: Morgan (1024-bit, radius 2) + 6 RDKit descriptors.
  3. Algorithm: sklearn Random Forest classifier (300 trees, class_weight=
     balanced, deterministic n_jobs=1).

HONEST SCOPE:
  * Predicts:  binary BBB-permeable probability + qualitative penetration class.
  * Does NOT predict: Kp,uu (unbound brain/plasma ratio) — that requires the
    PPB + brain-tissue binding numbers that only PBPK can provide.
  * Does NOT predict: efflux transporter substrate status separately (Pgp/BCRP
    membership is co-mixed into the binary label).
"""

from __future__ import annotations

import logging
import time
from typing import Any

import hakase_kernel.base as base

logger = logging.getLogger(__name__)

SPEC = base.ModelSpec(
    model_id="bbb_ml",
    version="1.0.0",
    tdc_file="bbb_martins.tab",
    task="classification",
    title="BBB-ML v1 (Random Forest, Morgan FP + RDKit descriptors)",
    method="Independent second-opinion BBB penetration classifier trained on TDC BBB_Martins",
    dataset_ref="TDC BBB_Martins (Martins et al., J. Chem. Inf. Model., 2012)",
)


def is_ready() -> dict[str, Any]:
    return base.status(SPEC)


def warmup() -> dict[str, Any]:
    return base.warmup(SPEC)


def _penetration_class(prob: float) -> str:
    if prob < 0.30:
        return "Low (peripherally restricted)"
    if prob < 0.60:
        return "Moderate"
    return "High (CNS-penetrant)"


def predict_bbb_ml(smiles: str) -> dict[str, Any]:
    t0 = time.time()
    result = base.predict_classification_probability(SPEC, smiles)
    if isinstance(result, dict):
        return result
    prob, feats, bundle = result
    inference_ms = round((time.time() - t0) * 1000, 2)
    ad = base.compute_ad(bundle, feats)
    return {
        "smiles": base.canonicalize(smiles.strip()) or smiles,
        "source": "ml",
        "ml_available": True,
        "prediction": {
            "penetration_probability": prob,
            "penetration_class": _penetration_class(prob),
            "label_convention": "positive = CNS-permeable (Martins 2012 binary curation)",
        },
        "applicability_domain": base.ad_envelope(ad),
        "model_info": base.model_info_block(SPEC, bundle, inference_ms),
    }
