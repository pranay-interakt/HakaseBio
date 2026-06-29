"""Applicability domain (AD) confidence scorer.

Answers the key question: "Is this molecule similar to anything in our training
data, or are we extrapolating into uncharted chemical space?"

Method: Tanimoto similarity between the query molecule's Morgan fingerprint and
the nearest-neighbour compound in the combined DILI + CardioTox training sets.
If the nearest-neighbour Tanimoto is below a threshold, the ML predictions are
likely extrapolations and should be treated with lower confidence.

Thresholds (Jaworska et al. 2005 ATLA, OECD QSAR Toolbox convention):
  ≥ 0.65  → In-domain    (high confidence)
  0.40–0.65 → Border-domain (moderate confidence)
  < 0.40  → Out-of-domain (low confidence, predictions are extrapolations)

The training fingerprints are loaded lazily on first call and cached in memory.

References
----------
- Jaworska et al. (2005) ATLA 33:445 — AD definition for QSAR models
- Netzeva et al. (2005) ATLA 33:155  — OECD guidance on AD
- Sahigara et al. (2012) Molecules 17:4791 — comparison of AD methods
- Sheridan (2012) J Chem Inf Model 52:814  — Tanimoto AD for RF models
"""

from __future__ import annotations
import logging
import threading
from typing import Any, Optional

import numpy as np
from rdkit import Chem
from rdkit.Chem import AllChem, DataStructs

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Lazy training fingerprint cache
# ---------------------------------------------------------------------------

_TRAIN_FPS: Optional[list[DataStructs.ExplicitBitVect]] = None
_TRAIN_SMILES_CACHE: Optional[list[str]] = None
_LOAD_LOCK = threading.Lock()

_MORGAN_RADIUS = 2
_MORGAN_NBITS = 2048

# AD thresholds
_IN_DOMAIN_THR    = 0.65
_BORDER_THR       = 0.40


def _mol_to_fp(mol) -> Optional[DataStructs.ExplicitBitVect]:
    try:
        return AllChem.GetMorganFingerprintAsBitVect(
            mol, radius=_MORGAN_RADIUS, nBits=_MORGAN_NBITS
        )
    except Exception:
        return None


def _load_training_fps() -> list[DataStructs.ExplicitBitVect]:
    """Load Morgan FPs for all training molecules.

    Sources (TDC, attempted in order):
      1. DILI training set (TDC Tox / DILIrank, ~475 compounds)
      2. CardioTox (hERG) training set (TDC Tox / hERG_Karim, ~657 compounds)

    If TDC is unavailable and no FPs are loaded, an empty list is returned.
    The caller (predict_applicability_domain) treats an empty list as
    "AD scoring unavailable" and returns null scores — never a fake result
    derived from a hardcoded reference set.
    """
    fps: list[DataStructs.ExplicitBitVect] = []
    collected_smiles: list[str] = []

    def _add_from_tdc(name: str) -> None:
        nonlocal fps, collected_smiles
        try:
            from tdc.single_pred import Tox  # type: ignore
            data = Tox(name=name).get_data()
            added = 0
            for smi in data["Drug"].tolist():
                try:
                    m = Chem.MolFromSmiles(str(smi))
                    if m is None:
                        continue
                    can = Chem.MolToSmiles(m, canonical=True)
                    if can in collected_smiles:
                        continue
                    fp = _mol_to_fp(Chem.MolFromSmiles(can))
                    if fp is not None:
                        fps.append(fp)
                        collected_smiles.append(can)
                        added += 1
                except Exception:
                    pass
            logger.info("AD: loaded %d FPs from TDC/%s (total so far: %d)", added, name, len(fps))
        except Exception as exc:
            logger.warning("AD: could not load TDC/%s: %s — AD scoring will be unavailable if no other source succeeds", name, exc)

    _add_from_tdc("DILI")
    _add_from_tdc("hERG_Karim")

    if not fps:
        logger.warning(
            "AD: no training fingerprints loaded (TDC unavailable). "
            "Applicability domain scoring will return null scores — "
            "no hardcoded reference set is used as a substitute."
        )

    return fps


def _get_training_fps() -> list[DataStructs.ExplicitBitVect]:
    global _TRAIN_FPS
    if _TRAIN_FPS is not None:
        return _TRAIN_FPS
    with _LOAD_LOCK:
        if _TRAIN_FPS is not None:
            return _TRAIN_FPS
        _TRAIN_FPS = _load_training_fps()
    return _TRAIN_FPS


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def predict_applicability_domain(smiles: str) -> dict[str, Any]:
    """Compute Tanimoto-based applicability domain score for a query molecule.

    Returns
    -------
    dict with:
      ad_score          — nearest-neighbour Tanimoto similarity [0.0, 1.0]
      ad_label          — "In-domain" | "Border-domain" | "Out-of-domain"
      ad_confidence     — "High" | "Moderate" | "Low"
      nn_similarity     — same as ad_score (explicit alias)
      coverage_note     — human-readable explanation
      model_info        — provenance
    """
    if not smiles or not smiles.strip():
        raise ValueError("smiles is required")

    mol = Chem.MolFromSmiles(smiles.strip())
    if mol is None:
        raise ValueError(f"Invalid SMILES: {smiles!r}")
    smiles = Chem.MolToSmiles(mol, canonical=True)
    mol = Chem.MolFromSmiles(smiles)

    query_fp = _mol_to_fp(mol)
    if query_fp is None:
        return {
            "smiles": smiles,
            "ad_score": 0.0,
            "ad_label": "Out-of-domain",
            "ad_confidence": "Low",
            "nn_similarity": 0.0,
            "coverage_note": "Could not compute Morgan fingerprint for this molecule",
            "model_info": {"engine": "Tanimoto AD", "error": "fingerprint_failed"},
        }

    train_fps = _get_training_fps()

    if not train_fps:
        # Edge case: no training data loaded
        return {
            "smiles": smiles,
            "ad_score": None,
            "ad_label": "Unknown",
            "ad_confidence": "Low",
            "nn_similarity": None,
            "coverage_note": "Training data unavailable — applicability domain cannot be assessed",
            "model_info": {"engine": "Tanimoto AD", "error": "no_training_fps"},
        }

    # Compute Tanimoto against all training FPs, take max
    similarities = DataStructs.BulkTanimotoSimilarity(query_fp, train_fps)
    nn_sim = float(np.max(similarities)) if similarities else 0.0

    # Determine domain label
    if nn_sim >= _IN_DOMAIN_THR:
        ad_label = "In-domain"
        ad_confidence = "High"
        coverage_note = (
            f"Nearest training analogue Tanimoto = {nn_sim:.2f} (≥{_IN_DOMAIN_THR}). "
            "This scaffold is well-represented in training data — ML predictions are reliable."
        )
    elif nn_sim >= _BORDER_THR:
        ad_label = "Border-domain"
        ad_confidence = "Moderate"
        coverage_note = (
            f"Nearest training analogue Tanimoto = {nn_sim:.2f} ({_BORDER_THR}–{_IN_DOMAIN_THR}). "
            "Scaffold has partial coverage in training data — treat ML predictions with moderate caution."
        )
    else:
        ad_label = "Out-of-domain"
        ad_confidence = "Low"
        coverage_note = (
            f"Nearest training analogue Tanimoto = {nn_sim:.2f} (<{_BORDER_THR}). "
            "Novel scaffold with no close analogues in training data — ML predictions are extrapolations. "
            "Rule-based ADMET and structural alert results remain valid, but quantitative ML values "
            "should be treated as directional only."
        )

    return {
        "smiles": smiles,
        "ad_score": round(nn_sim, 4),
        "ad_label": ad_label,
        "ad_confidence": ad_confidence,
        "nn_similarity": round(nn_sim, 4),
        "coverage_note": coverage_note,
        "training_set_size": len(train_fps),
        "model_info": {
            "engine": "HakaseAI Applicability Domain v1.0 (Tanimoto k-NN, k=1)",
            "method": f"Morgan FP (radius={_MORGAN_RADIUS}, {_MORGAN_NBITS} bits) — Tanimoto NN",
            "thresholds": {
                "in_domain": _IN_DOMAIN_THR,
                "border": _BORDER_THR,
            },
            "training_compounds": len(train_fps),
            "references": [
                "Jaworska et al. (2005) ATLA 33:445",
                "Netzeva et al. (2005) ATLA 33:155",
                "Sheridan (2012) J Chem Inf Model 52:814",
            ],
        },
    }
