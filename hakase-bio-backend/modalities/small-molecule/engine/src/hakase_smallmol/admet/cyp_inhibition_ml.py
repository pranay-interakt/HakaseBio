"""CYP-inhibition-ML — CYP2C9, CYP2D6, CYP3A4 inhibition classifiers.

Three independent Random Forest classifiers on TDC PubChem-BioAssay Veith
datasets (~12k compounds each). The CYP2C9/2D6/3A4 triad is the standard
DDI risk gate for oral drug programs — every first-in-human dossier needs
these predictions.

Methodology (identical family as `cardiotox.py`, `dili_ml.py`, `ames_ml.py`):
  1. Public training data: TDC `CYP{2C9,2D6,3A4}_Veith` (Veith et al.,
     Nat. Biotechnol., 2009; qHTS in PubChem BioAssay). Binary label
     ("1" = inhibitor at 10 µM). CC-BY 4.0 via Therapeutics Data Commons.
  2. Feature representation: Morgan (1024-bit, radius 2) + 6 RDKit descriptors.
  3. Algorithm: sklearn Random Forest classifier (300 trees, class_weight=
     balanced, deterministic n_jobs=1).

HONEST SCOPE:
  * Predicts:  per-isoform inhibitor probability + qualitative DDI risk.
  * Does NOT predict: IC50/Ki (only the binary inhibitor call at qHTS cutoff).
  * Does NOT predict: substrate vs inhibitor mechanism, or reversible vs
    time-dependent inhibition — the training corpus lumps all inhibitors.
  * Does NOT predict: induction or CYP1A2/2C19/2E1/2B6 (those live in the
    Hakase ADMET Chemprop ensemble).

Trains on first call from the vendored `.tab` files (~30-60s total for all
three isoforms on typical CPU), caches each pipeline as a separate pickle.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import hakase_kernel.base as base

logger = logging.getLogger(__name__)

ISOFORM_SPECS: dict[str, base.ModelSpec] = {
    "CYP2C9": base.ModelSpec(
        model_id="cyp2c9_ml",
        version="1.0.0",
        tdc_file="cyp2c9_veith.tab",
        task="classification",
        title="CYP2C9-inhibition-ML v1 (Random Forest, Morgan FP + RDKit descriptors)",
        method="Independent second-opinion CYP2C9 inhibition classifier trained on TDC CYP2C9_Veith",
        dataset_ref="TDC CYP2C9_Veith (Veith et al., Nat. Biotechnol., 2009; PubChem qHTS)",
    ),
    "CYP2D6": base.ModelSpec(
        model_id="cyp2d6_ml",
        version="1.0.0",
        tdc_file="cyp2d6_veith.tab",
        task="classification",
        title="CYP2D6-inhibition-ML v1 (Random Forest, Morgan FP + RDKit descriptors)",
        method="Independent second-opinion CYP2D6 inhibition classifier trained on TDC CYP2D6_Veith",
        dataset_ref="TDC CYP2D6_Veith (Veith et al., Nat. Biotechnol., 2009; PubChem qHTS)",
    ),
    "CYP3A4": base.ModelSpec(
        model_id="cyp3a4_ml",
        version="1.0.0",
        tdc_file="cyp3a4_veith.tab",
        task="classification",
        title="CYP3A4-inhibition-ML v1 (Random Forest, Morgan FP + RDKit descriptors)",
        method="Independent second-opinion CYP3A4 inhibition classifier trained on TDC CYP3A4_Veith",
        dataset_ref="TDC CYP3A4_Veith (Veith et al., Nat. Biotechnol., 2009; PubChem qHTS)",
    ),
}


def is_ready() -> dict[str, Any]:
    return {iso: base.status(spec) for iso, spec in ISOFORM_SPECS.items()}


def warmup() -> dict[str, Any]:
    return {iso: base.warmup(spec) for iso, spec in ISOFORM_SPECS.items()}


def _risk_class(prob: float) -> str:
    if prob < 0.30:
        return "Low"
    if prob < 0.60:
        return "Moderate"
    return "High"


def _predict_one(iso: str, smiles: str) -> dict[str, Any]:
    spec = ISOFORM_SPECS[iso]
    t0 = time.time()
    result = base.predict_classification_probability(spec, smiles)
    if isinstance(result, dict):
        return {"isoform": iso, **result}
    prob, feats, bundle = result
    inference_ms = round((time.time() - t0) * 1000, 2)
    ad = base.compute_ad(bundle, feats)
    return {
        "isoform": iso,
        "smiles": base.canonicalize(smiles.strip()) or smiles,
        "source": "ml",
        "ml_available": True,
        "prediction": {
            "inhibitor_probability": prob,
            "risk_class": _risk_class(prob),
            "label_convention": "positive = qHTS inhibitor call at 10 µM (Veith 2009)",
        },
        "applicability_domain": base.ad_envelope(ad),
        "model_info": base.model_info_block(spec, bundle, inference_ms),
    }


def predict_cyp_inhibition_ml(smiles: str) -> dict[str, Any]:
    """Predict CYP2C9/2D6/3A4 inhibition for one SMILES.

    Returns a dict keyed by isoform, plus an aggregate `ddi_risk_summary`.
    Each isoform sub-response is either a full ML envelope or a fallback
    envelope with `ml_available: False`.
    """
    if not smiles or not smiles.strip():
        raise ValueError("smiles is required")

    per_iso = {iso: _predict_one(iso, smiles) for iso in ISOFORM_SPECS}

    # Aggregate DDI-risk summary — only counts isoforms whose prediction succeeded.
    probs: dict[str, float] = {}
    for iso, resp in per_iso.items():
        pred = resp.get("prediction") or {}
        p = pred.get("inhibitor_probability")
        if isinstance(p, (int, float)):
            probs[iso] = float(p)
    if probs:
        max_iso = max(probs, key=lambda k: probs[k])
        max_prob = probs[max_iso]
        summary = {
            "n_isoforms_scored": len(probs),
            "highest_risk_isoform": max_iso,
            "highest_risk_probability": max_prob,
            "highest_risk_class": _risk_class(max_prob),
            "note": (
                "Aggregate DDI risk based on the highest-scoring CYP isoform. "
                "A high probability on 3A4 has the broadest DDI implication "
                "because ~50% of marketed drugs are 3A4 substrates."
            ),
        }
    else:
        summary = {
            "n_isoforms_scored": 0,
            "note": "All three isoform predictions failed — see per-isoform error fields.",
        }

    return {"per_isoform": per_iso, "ddi_risk_summary": summary}
