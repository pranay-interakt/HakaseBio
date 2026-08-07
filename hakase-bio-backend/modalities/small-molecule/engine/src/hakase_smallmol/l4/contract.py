"""The L3 → first-in-human handoff, made explicit.

Mirrors ``l3_input_contract``: given a completed animal ``study_id`` it tells
the UI exactly what the first-in-human layer received, which blocks it will be
able to produce, and which clinical-design inputs the user must still supply.
The browser renders this; it never derives an L4 value.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from hakase_smallmol.l3.store import get_study
from hakase_smallmol.l4 import SCHEMA_VERSION
from hakase_smallmol.l4.escalation_engine import SCHEMES
from hakase_smallmol.l4.ind_gate_engine import CHECKLIST as IND_CHECKLIST
from hakase_smallmol.l4.ind_gate_engine import REGIONS
from hakase_smallmol.l4.translation_engine import (
    KM_FACTORS,
    REFERENCE_HUMAN_WEIGHT_KG,
    RISK_FACTORS,
)

SUPPORTED_ROUTES = ("ORAL", "IV", "SC")
SUPPORTED_FREQUENCIES = ("SINGLE", "QD", "BID", "TID", "Q12H", "Q8H")


def _readiness(study: dict[str, Any]) -> dict[str, Any]:
    """Which L4 output blocks the supplied animal study can support."""
    pod = study.get("points_of_departure") or {}
    potency = (study.get("resolved_inputs") or {}).get("potency")
    species = (study.get("study_summary") or {}).get("species")
    preferred = pod.get("preferred_pod")
    pod_exposure = pod.get("preferred_pod_exposure") or {}

    checks: list[dict[str, Any]] = []

    has_km = bool(species and species.strip().lower() in KM_FACTORS)
    checks.append(
        {
            "block": "NOAEL / HED translation",
            "ready": bool(preferred and has_km),
            "requires": "A point of departure rated strong or moderate, in a species with a published FDA km factor.",
            "note": (
                None
                if (preferred and has_km)
                else (
                    f"No FDA km factor is published for {species!r}."
                    if not has_km
                    else "No strong or moderate point of departure was derived by the animal study; "
                    "an in-vivo NOAEL is the gating measurement."
                )
            ),
        }
    )
    checks.append(
        {
            "block": "MABEL / pharmacologically active dose",
            "ready": bool(potency),
            "requires": "A target potency (Ki/IC50/Kd) from the Layer-1 binding readout or ChEMBL.",
            "note": None if potency else "No potency was carried through from Layer 1.",
        }
    )
    checks.append(
        {
            "block": "Human exposure projection",
            "ready": True,
            "requires": "A valid structure plus the Layer-1 ADMET handoff (always present here).",
            "note": None,
        }
    )
    checks.append(
        {
            "block": "Exposure-based safety margin",
            "ready": bool(pod_exposure.get("available")),
            "requires": "Animal exposure at the point of departure, from the study's dose–exposure calibration.",
            "note": (
                None
                if pod_exposure.get("available")
                else "Without an animal point-of-departure exposure only the dose-based FDA "
                "comparison is available."
            ),
        }
    )
    checks.append(
        {
            "block": "Escalation operating characteristics",
            "ready": False,
            "requires": "A per-level dose–toxicity assumption supplied by the user.",
            "note": (
                "This platform predicts hazard mechanisms, not human dose-limiting-toxicity "
                "rates, so the 3+3 simulation needs an explicit assumption to run against."
            ),
        }
    )

    return {
        "overall_ready": bool(preferred and has_km) or bool(potency),
        "checks": checks,
        "limitations": (
            "Readiness reflects input availability only. A 'ready' block can still return a "
            "low-confidence result — most importantly, human clearance is projected by IVIVE "
            "and has not been confirmed against measured human PK."
        ),
    }


def l4_input_contract(study_id: str) -> dict[str, Any]:
    """Build the first-in-human handoff/readiness contract for an animal study."""
    study = get_study(study_id)  # raises ValueError if unknown
    study_summary = study.get("study_summary") or {}
    pod = study.get("points_of_departure") or {}
    toxicology_summary = (study.get("toxicology") or {}).get("summary") or {}

    return {
        "schema_version": SCHEMA_VERSION,
        "status": "available",
        "generated_at": datetime.now(UTC).isoformat(),
        "owner": "hakase_smallmol.l4.pipeline",
        "source": {
            "study_id": study_id,
            "analysis_id": study.get("analysis_id"),
            "smiles": study.get("smiles"),
            "animal_species": study_summary.get("species"),
            "animal_route": study_summary.get("route"),
            "animal_dose_groups_mg_kg": study_summary.get("dose_groups_mg_kg"),
            "stage_gate": (study.get("stage_gate") or {}).get("recommendation"),
            "target": (study.get("resolved_inputs") or {}).get("target"),
            "potency": (study.get("resolved_inputs") or {}).get("potency"),
        },
        "inherited": {
            "points_of_departure": [
                {
                    "id": c.get("id"),
                    "name": c.get("name"),
                    "dose_mg_per_kg": c.get("dose_mg_per_kg"),
                    "strength": c.get("strength"),
                    "provenance": c.get("provenance"),
                }
                for c in pod.get("candidates", [])
            ],
            "preferred_pod": pod.get("preferred_pod"),
            "preferred_pod_exposure": pod.get("preferred_pod_exposure"),
            "high_hazard_domains": toxicology_summary.get("high_hazard_domains") or [],
            "flagged_domains": toxicology_summary.get("flagged_domains") or [],
        },
        "readiness": _readiness(study),
        "clinical_design_options": {
            "routes": list(SUPPORTED_ROUTES),
            "frequencies": list(SUPPORTED_FREQUENCIES),
            "escalation_schemes": [
                {"id": key, "name": spec["name"], "reference": spec["reference"]}
                for key, spec in SCHEMES.items()
            ],
            "risk_factors": [
                {
                    "id": rf["id"],
                    "label": rf["label"],
                    "additional_factor": rf["additional_factor"],
                }
                for rf in RISK_FACTORS
            ],
            "reference_human_weight_kg": REFERENCE_HUMAN_WEIGHT_KG,
            "cohort_defaults": {
                "sad_cohort_size": 8,
                "mad_cohort_size": 12,
                "randomisation": "3:1 active:placebo",
            },
            "regulatory_regions": [
                {
                    "id": spec["id"],
                    "name": spec["name"],
                    "application": spec["application"],
                    "framework": spec["framework"],
                    "region_specific": spec["region_specific"],
                }
                for spec in REGIONS.values()
            ],
            "ind_checklist_items": [
                {
                    "id": item["id"],
                    "requirement": item["requirement"],
                    "guideline": item["guideline"],
                    "satisfiable_by_simulation": item["satisfiable_by_simulation"],
                    "contribution": item["contribution"],
                }
                for item in IND_CHECKLIST
            ],
            "benefit_risk": {
                "requires": "An indication. The FDA framework weighs risk against a specific "
                "condition's severity and unmet need, so it cannot run without one.",
                "note": "Supplied by the reviewer; never inferred from the structure.",
            },
        },
        "provenance": {
            "source_study_id": study_id,
            "client_contract": "display-only",
        },
    }


__all__ = ["SUPPORTED_FREQUENCIES", "SUPPORTED_ROUTES", "l4_input_contract"]
