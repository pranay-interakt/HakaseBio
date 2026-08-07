"""Safety margins: three clearly-labelled anchors + dose margins + hazard flags.

Per the design decision, the safety block reports up to three anchors, each with
its own provenance, and never a single fabricated NOAEL:

  1. Evidence NOAEL (measured)   — EPA CCTE / ToxRefDB in-vivo NOAEL, if located.
  2. Allometric MTD/NOAEL (model-derived, weaker provenance) — the evidence
     anchor scaled to the study species by FDA body-surface-area (km) allometry,
     with an explicit interspecies uncertainty interval (÷/×3). Returned only
     when there is a real anchor to scale — an absolute MTD is never invented.
  3. In-vitro POD (status)       — reverse-dosimetry point-of-departure; requires
     ToxCast AC50 data, not integrated in v1 → reported as such, not faked.

Dose margins compare each arm's dose to the anchors; hazard flags forward the
L1/L2 organ-liability signals verbatim.

References
  • FDA (2005) Estimating the Maximum Safe Starting Dose in Initial Clinical
    Trials for Therapeutics in Adult Healthy Volunteers — BSA (km) conversion.
"""

from __future__ import annotations

from typing import Any

# FDA (2005) km factors (body weight ÷ body-surface-area). Literature reference
# constants for interspecies dose conversion — NOT per-molecule values.
KM_FACTORS: dict[str, float] = {
    "mouse": 3.0,
    "rat": 6.0,
    "rabbit": 12.0,
    "monkey": 12.0,
    "dog": 20.0,
    "human": 37.0,
}

# Standard interspecies uncertainty factor for a single-species allometric scale.
_INTERSPECIES_UF = 3.0
# When only an LD50 is available, a conservative LD50→NOAEL divisor (order-of-
# magnitude convention; the estimate is flagged low-confidence accordingly).
_LD50_TO_NOAEL_DIVISOR = 100.0


def _km(species: str | None) -> float | None:
    if not species:
        return None
    return KM_FACTORS.get(species.strip().lower())


def _source_species(evidence: dict[str, Any]) -> str | None:
    """Pick a source species from the evidence NOAEL coverage (rodent preferred)."""
    anchor = (evidence or {}).get("noael_anchor") or {}
    covered = [s.lower() for s in (anchor.get("species_covered") or [])]
    for pref in ("rat", "mouse", "dog", "monkey", "rabbit"):
        if pref in covered:
            return pref
    return covered[0] if covered else None


def allometric_anchor(evidence: dict[str, Any], study_species: str) -> dict[str, Any]:
    """Scale the best evidence anchor to the study species (FDA km allometry).

    NOAEL preferred; else LD50 ÷ divisor as a conservative surrogate. Returns a
    model-derived estimate with a ÷/×3 interspecies interval, or ``not_predicted``
    when there is no real anchor to scale.
    """
    km_study = _km(study_species)
    if km_study is None:
        return {"available": False, "reason": f"No km factor for study species {study_species!r}."}

    noael_anchor = (evidence or {}).get("noael_anchor") or {}
    ld50_anchor = (evidence or {}).get("ld50_anchor") or {}

    src_species = _source_species(evidence)
    km_src = _km(src_species)

    base_mg_kg: float | None = None
    basis: str | None = None
    confidence = "low"
    source = None
    if noael_anchor.get("noael_mg_kg_day") and km_src:
        base_mg_kg = float(noael_anchor["noael_mg_kg_day"])
        basis = f"NOAEL in {src_species}"
        source = noael_anchor.get("source")
        confidence = "moderate"
    elif ld50_anchor.get("ld50_mg_kg"):
        # LD50 has no species-of-record here; treat as rat-equivalent (conservative).
        km_src = km_src or KM_FACTORS["rat"]
        src_species = src_species or "rat"
        base_mg_kg = float(ld50_anchor["ld50_mg_kg"]) / _LD50_TO_NOAEL_DIVISOR
        basis = f"LD50÷{_LD50_TO_NOAEL_DIVISOR:g} (rat-equivalent surrogate)"
        source = ld50_anchor.get("source")
        confidence = "low"

    if base_mg_kg is None or not km_src:
        return {
            "available": False,
            "reason": "No public NOAEL/LD50 anchor to scale allometrically.",
        }

    scaled = base_mg_kg * (km_src / km_study)
    return {
        "available": True,
        "estimated_noael_mg_kg_study_species": round(scaled, 4),
        "interval_mg_kg": [
            round(scaled / _INTERSPECIES_UF, 4),
            round(scaled * _INTERSPECIES_UF, 4),
        ],
        "study_species": study_species,
        "source_species": src_species,
        "basis": basis,
        "km_factors": {"source": km_src, "study": km_study},
        "interspecies_uncertainty_factor": _INTERSPECIES_UF,
        "model": "FDA (2005) BSA (km) interspecies dose scaling of a public evidence anchor",
        "confidence": confidence,
        "provenance": "derived",
        "source": source,
        "limitations": (
            "Model-derived estimate: a single-species allometric scaling of one public anchor. "
            "Weaker provenance than a direct measured NOAEL; the interval reflects interspecies "
            "uncertainty only, not chemical-specific mechanism."
        ),
    }


def _dose_margin(anchor_mg_kg: float | None, dose_mg_kg: float) -> float | None:
    if anchor_mg_kg is None or not (dose_mg_kg and dose_mg_kg > 0):
        return None
    return round(anchor_mg_kg / dose_mg_kg, 3)


def compute_safety(
    *,
    resolved_safety_flags: dict[str, Any],
    arm_results: list[dict[str, Any]],
    evidence: dict[str, Any],
    study_species: str,
) -> dict[str, Any]:
    """Assemble the Safety Margins block."""
    noael_anchor = (evidence or {}).get("noael_anchor") or {}
    ld50_anchor = (evidence or {}).get("ld50_anchor") or {}
    allo = allometric_anchor(evidence, study_species)

    # Determine per-arm dose margins against each available anchor.
    allo_mg_kg = allo.get("estimated_noael_mg_kg_study_species") if allo.get("available") else None
    # Evidence NOAEL is mg/kg/day in its source species; scale to study species for a like comparison.
    evidence_noael_study = None
    if noael_anchor.get("noael_mg_kg_day") and allo.get("available"):
        evidence_noael_study = allo_mg_kg  # allo already scaled the evidence NOAEL
    ld50_mg_kg = ld50_anchor.get("ld50_mg_kg")

    per_arm_margins = []
    for arm in arm_results:
        if not arm.get("available"):
            continue
        info = arm.get("arm") or {}
        dose = info.get("dose_mg_per_kg")
        per_arm_margins.append(
            {
                "arm": info.get("label"),
                "dose_mg_per_kg": dose,
                "margin_to_allometric_noael": _dose_margin(allo_mg_kg, dose),
                "margin_to_ld50": _dose_margin(ld50_mg_kg, dose),
            }
        )

    # Forward hazard flags (qualitative organ liabilities from L1/L2 ML).
    hazard_flags = []
    for name, entry in (resolved_safety_flags or {}).items():
        if not isinstance(entry, dict):
            continue
        hazard_flags.append(
            {
                "endpoint": name,
                "signal": entry.get("signal") or entry.get("label") or entry.get("status"),
                "probability": entry.get("probability"),
            }
        )

    return {
        "anchors": {
            "evidence_noael": (
                {
                    "value_mg_kg_day": noael_anchor.get("noael_mg_kg_day"),
                    "species_covered": noael_anchor.get("species_covered"),
                    "provenance": "measured",
                    "source": noael_anchor.get("source"),
                }
                if noael_anchor.get("noael_mg_kg_day")
                else {"available": False, "reason": "No measured in-vivo NOAEL located."}
            ),
            "allometric_mtd_noael": allo,
            "in_vitro_pod": {
                "available": False,
                "status": "not_integrated",
                "reason": (
                    "Reverse-dosimetry from a ToxCast AC50 point-of-departure is not integrated in "
                    "v1. Toxicological in-vitro POD requires assay AC50 data; the pharmacological "
                    "target-engagement readout is in the Target Coverage block."
                ),
            },
        },
        "per_arm_margins": per_arm_margins,
        "hazard_flags": hazard_flags,
        "ld50_anchor": ld50_anchor or {"available": False},
        "model": "Public-evidence anchors + FDA km allometry + L1/L2 hazard ML",
        "provenance": "mixed (measured evidence + derived allometry + ml hazard flags)",
        "limitations": (
            "Margins are dose-based (NOAEL/LD50 vs administered dose), not AUC-based, because the "
            "public anchors are reported as doses. A quantitative NOAEL is never invented; where no "
            "anchor exists only qualitative hazard flags are shown."
        ),
    }


__all__ = ["KM_FACTORS", "allometric_anchor", "compute_safety"]
