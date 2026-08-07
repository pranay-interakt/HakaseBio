"""Applicability-domain (AD) confidence — no local data, no storage, no lookup.

Rewritten to satisfy the strict SaaS/no-fabrication rules: this module holds NO
embedded reference dataset, writes NO cache, and reads NO local file. Every
signal is computed live at inference:

  * Physicochemical-envelope score — computed from the query molecule's own
    RDKit descriptors (MW/logP/TPSA/HBD/HBA/rotatable bonds) against published
    oral-drug envelopes. This is arithmetic on the molecule, not a lookup.

  * Model-uncertainty aggregate — the mean per-endpoint confidence derived from
    the models' own ensemble disagreement (see `uncertainty.py`), passed in by
    the caller. This is the primary, data-free reliability signal.

Confidence never suppresses a prediction — it annotates it. A low value flags
extrapolation; the number is still returned.
"""

from __future__ import annotations

from typing import Any

from . import uncertainty as U

MODULE_VERSION = "2.0.0"

# Physicochemical oral-drug envelopes (Lipinski/Veber-informed soft bounds).
_PHYSCHEM_BOUNDS = {
    "MolWt": (150.0, 600.0),
    "MolLogP": (-1.0, 6.0),
    "TPSA": (0.0, 160.0),
    "HBD": (0, 5),
    "HBA": (0, 12),
    "RotB": (0, 12),
}


def physchem_domain_score(desc: dict[str, float]) -> float:
    """Fraction of key descriptors within the oral-drug envelope [0,1]."""
    if not desc:
        return 0.5
    inside = total = 0
    for key, (lo, hi) in _PHYSCHEM_BOUNDS.items():
        v = desc.get(key)
        if v is None:
            continue
        total += 1
        if lo <= v <= hi:
            inside += 1
    return inside / total if total else 0.5


def _descriptors(smiles: str) -> dict[str, float]:
    """Live RDKit descriptors — computed from the molecule, not looked up."""
    try:
        from rdkit import Chem
        from rdkit.Chem import Crippen, Descriptors, rdMolDescriptors

        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return {}
        return {
            "MolWt": float(Descriptors.MolWt(mol)),
            "MolLogP": float(Crippen.MolLogP(mol)),
            "TPSA": float(rdMolDescriptors.CalcTPSA(mol)),
            "HBD": float(rdMolDescriptors.CalcNumHBD(mol)),
            "HBA": float(rdMolDescriptors.CalcNumHBA(mol)),
            "RotB": float(rdMolDescriptors.CalcNumRotatableBonds(mol)),
        }
    except Exception:  # noqa: BLE001
        return {}


def combine(physchem: float, model_uncertainty_conf: float | None) -> dict[str, Any]:
    """Blend physchem-envelope with the model-uncertainty aggregate.

    When model uncertainty is available it dominates (70/30) — it is the
    stronger, prediction-specific signal. When it is not, physchem carries it.
    """
    if model_uncertainty_conf is not None:
        confidence = round(0.70 * model_uncertainty_conf + 0.30 * physchem, 3)
        basis = "model-ensemble-uncertainty + physchem-envelope"
    else:
        confidence = round(physchem, 3)
        basis = "physchem-envelope only (model ensemble variance unavailable)"
    return {
        "confidence": confidence,
        "reliability": U.reliability_band(confidence),
        "physchem_domain_score": round(physchem, 3),
        "model_uncertainty_confidence": (
            None if model_uncertainty_conf is None else round(model_uncertainty_conf, 3)
        ),
        "in_domain": confidence >= 0.33,
        "basis": basis,
        "note": (
            "Confidence is computed live from the models' own ensemble "
            "disagreement and the molecule's physicochemical envelope. No "
            "reference dataset, cache, or local lookup is used. Low "
            "confidence flags extrapolation; the prediction is still "
            "returned, never suppressed."
        ),
        "module_version": MODULE_VERSION,
    }


def assess(smiles: str, model_uncertainty_conf: float | None = None) -> dict[str, Any]:
    """Applicability-domain confidence for a SMILES. Always returns a number.

    Args:
        smiles: query structure (descriptors computed live via RDKit).
        model_uncertainty_conf: optional aggregate model confidence in [0,1]
            from ensemble disagreement (supplied by the panel orchestrator).
    """
    desc = _descriptors(smiles)
    return combine(physchem_domain_score(desc), model_uncertainty_conf)
