"""Parameter resolution: pull L3's inputs from the immutable L1/L2 record.

L3 never re-derives PK, potency, or safety — it *consumes* what L1/L2 already
computed. This module reads the persisted analysis record and returns a single
``ResolvedInputs`` bundle plus a **simulation-readiness** verdict: which inputs
are present (with provenance) and which blocks will therefore be available.

No number is computed here; only located, unwrapped, and provenance-tagged.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ResolvedInputs:
    smiles: str
    analysis_id: str | None
    ml_inputs: dict[str, float] = field(default_factory=dict)  # IVIVE ADMET reuse
    target_uniprot: str | None = None
    target_protein: str | None = None
    target_gene: str | None = None
    therapeutic_area: str | None = None
    potency: dict[str, Any] | None = None  # {value_nM, kind, provenance, source}
    safety_flags: dict[str, Any] = field(default_factory=dict)  # hERG/DILI/Ames/... signals
    l1_verdict: dict[str, Any] | None = None
    l1_override: dict[str, Any] | None = None  # recorded L1 manual review, if any
    # The full L1 analysis record, kept so the outcome engines can read the
    # already-computed ADMET/Tox21/CYP endpoints instead of re-inferring them.
    analysis: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "smiles": self.smiles,
            "analysis_id": self.analysis_id,
            "ml_inputs_present": sorted(self.ml_inputs.keys()),
            "target": {
                "uniprot_id": self.target_uniprot,
                "target_protein": self.target_protein,
                "gene_symbol": self.target_gene,
            },
            "therapeutic_area": self.therapeutic_area,
            "potency": self.potency,
            "safety_flags": self.safety_flags,
            "l1_verdict": self.l1_verdict,
            "l1_override": self.l1_override,
        }


def _num(x: Any) -> float | None:
    if isinstance(x, bool):
        return None
    if isinstance(x, (int, float)):
        f = float(x)
        return f if f == f else None  # reject NaN
    return None


def _extract_potency(analysis: dict[str, Any]) -> dict[str, Any] | None:
    """Locate a target-potency value in the L1 record (BindingML Kd), if any.

    L1 stores an optional BindingML run under
    ``optional_model_runs.binding_simulation.result.prediction`` with a
    ``Kd_nM`` (and ``pKd_predicted`` / ``affinity_class``). This is an ML
    prediction — tagged provenance ``ml`` — used only when present.
    """
    run = ((analysis.get("optional_model_runs") or {}).get("binding_simulation")) or {}
    if run.get("status") != "available":
        return None
    prediction = (run.get("result") or {}).get("prediction") or {}
    kd = _num(prediction.get("Kd_nM"))
    if kd is None or kd <= 0:
        return None
    return {
        "value_nM": kd,
        "kind": "Kd",
        "pKd": _num(prediction.get("pKd_predicted")),
        "affinity_class": prediction.get("affinity_class"),
        "provenance": "ml",
        "source": "Hakase BindingML (L1 binding simulation)",
    }


def _extract_safety_flags(analysis: dict[str, Any]) -> dict[str, Any]:
    """Copy the L1/L2 safety signals verbatim (no recomputation).

    ``safety_assessments`` is the L1 record's per-endpoint block (hERG, DILI,
    etc.). Each carries its own signal/probability; L3 only forwards them.
    """
    out: dict[str, Any] = {}
    for name, entry in (analysis.get("safety_assessments") or {}).items():
        if isinstance(entry, dict):
            out[name] = {
                k: entry.get(k)
                for k in ("signal", "probability", "value", "status", "label", "prediction")
                if k in entry
            }
    return out


def resolve_from_analysis(analysis_id: str) -> ResolvedInputs:
    """Resolve L3 inputs from a persisted L1 analysis (the normal path)."""
    from hakase_smallmol.l1.pipeline import get_l1_analysis
    from hakase_smallmol.l2.pipeline import l1_ivive_inputs

    stored = get_l1_analysis(analysis_id)  # raises ValueError if unknown
    analysis = stored["analysis"]
    requested = stored.get("requested") or {}
    smiles = str(analysis.get("canonical_smiles") or "")

    ml_inputs = l1_ivive_inputs({"admet_endpoints": analysis.get("admet_ai_endpoints") or {}})
    target_evidence = analysis.get("target_evidence") or {}
    target_resolution = analysis.get("target_resolution") or {}
    gene = (target_evidence.get("gene_symbol") or target_resolution.get("gene_symbol")) or None

    return ResolvedInputs(
        smiles=smiles,
        analysis_id=analysis_id,
        ml_inputs=ml_inputs,
        target_uniprot=requested.get("uniprot_id"),
        target_protein=requested.get("target_protein"),
        target_gene=gene.strip().upper() if isinstance(gene, str) and gene.strip() else None,
        therapeutic_area=requested.get("therapeutic_area"),
        potency=_extract_potency(analysis),
        safety_flags=_extract_safety_flags(analysis),
        l1_verdict=analysis.get("verdict"),
        l1_override=stored.get("override"),
        analysis=analysis,
    )


def resolve_from_smiles(smiles: str) -> ResolvedInputs:
    """Fallback: a raw SMILES with no L1 record (no potency/safety context)."""
    return ResolvedInputs(smiles=smiles.strip(), analysis_id=None)


def readiness(resolved: ResolvedInputs) -> dict[str, Any]:
    """Which L3 output blocks will be available given the resolved inputs.

    This is the *Simulation Readiness* output — a first-class, honest statement
    of what can and cannot be produced, before any simulation runs.
    """
    from hakase_kernel.uncertainty.applicability_domain import predict_applicability_domain

    checks: list[dict[str, Any]] = []

    smiles_ok = bool(resolved.smiles and resolved.smiles.strip())
    checks.append(
        {
            "block": "Plasma PK / Tissue Exposure / PK Metrics",
            "ready": smiles_ok,
            "requires": "A valid structure + IVIVE disposition inputs (ADMET ML or measured).",
            "note": None if smiles_ok else "No molecular structure resolved.",
        }
    )

    ad_label = None
    if smiles_ok:
        try:
            ad = predict_applicability_domain(resolved.smiles)
            ad_label = ad.get("ad_label")
        except Exception:  # noqa: BLE001
            ad_label = None
    in_domain = ad_label in {"In-domain", "Border-domain"}
    checks.append(
        {
            "block": "Exposure projection (applicability gate)",
            "ready": in_domain,
            "requires": "Compound within the ADMET model applicability domain.",
            "note": None if in_domain else f"Applicability: {ad_label or 'unavailable'}.",
        }
    )

    has_potency = resolved.potency is not None
    checks.append(
        {
            "block": "Target Coverage / PK-PD",
            "ready": has_potency,
            "requires": "A target potency value (Ki/IC50/Kd) from L1 binding or ChEMBL.",
            "note": (
                None
                if has_potency
                else "No potency in the L1 record; target coverage will be sought from ChEMBL or marked not-predicted."
            ),
        }
    )

    has_safety = bool(resolved.safety_flags)
    checks.append(
        {
            "block": "Safety hazard flags",
            "ready": has_safety,
            "requires": "L1/L2 safety ML signals (hERG/DILI/Ames/...).",
            "note": None if has_safety else "No safety signals in the record.",
        }
    )

    return {
        "overall_ready": smiles_ok and in_domain,
        "applicability_domain": ad_label,
        "checks": checks,
        "inputs": resolved.to_dict(),
        "limitations": (
            "Readiness reflects only input availability. A 'ready' block can still return "
            "a low-confidence result (e.g. non-human species driven by human-trained ML "
            "clearance), which is flagged per output."
        ),
    }


__all__ = [
    "ResolvedInputs",
    "resolve_from_analysis",
    "resolve_from_smiles",
    "readiness",
]
