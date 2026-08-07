"""The L3 input contract — the L1/L2 → Animal-Cohort handoff, made explicit.

Mirrors ``l2_input_contract``: given an ``analysis_id`` (or a raw SMILES), it
tells the UI exactly what L3 received, what it can simulate, and what study-
design inputs the user must still supply. The browser renders this; it never
derives an L3 value.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from hakase_smallmol.l3 import SCHEMA_VERSION
from hakase_smallmol.l3.parameter_engine import (
    readiness,
    resolve_from_analysis,
    resolve_from_smiles,
)
from hakase_smallmol.l3.study_engine import (
    SUPPORTED_FREQUENCIES,
    SUPPORTED_ROUTES,
    species_catalog,
)
from hakase_smallmol.l3.study_outcomes_engine import GUIDELINE_EXPECTATIONS


def _engine_options() -> list[dict[str, Any]]:
    """Available simulation engines, with mrgsolve availability probed live."""
    from hakase_smallmol.l3.mrgsolve_adapter import mrgsolve_info

    mrg = mrgsolve_info()
    return [
        {
            "id": "auto",
            "name": "Automatic (prefer mrgsolve)",
            "available": True,
            "description": "Use mrgsolve when installed, otherwise the in-house kernel PBPK.",
        },
        {
            "id": "mrgsolve",
            "name": "mrgsolve (Metrum, R/C++)",
            "available": bool(mrg.get("available")),
            "version": mrg.get("version"),
            "description": (
                "Metrum's validated ODE PBPK engine. Same disposition & physiology as the kernel."
                if mrg.get("available")
                else mrg.get("reason", "R/mrgsolve not installed.")
            ),
        },
        {
            "id": "kernel",
            "name": "Hakase kernel PBPK (scipy)",
            "available": True,
            "description": "The in-house 13-compartment perfusion-limited PBPK (always available).",
        },
    ]


def l3_input_contract(analysis_id: str | None = None, smiles: str | None = None) -> dict[str, Any]:
    """Build the L3 handoff/readiness contract."""
    if analysis_id:
        resolved = resolve_from_analysis(analysis_id)  # raises ValueError if unknown
    elif smiles and smiles.strip():
        resolved = resolve_from_smiles(smiles)
    else:
        raise ValueError(
            "Provide an analysis_id (from L1) or a SMILES to open the animal-study layer."
        )

    return {
        "schema_version": SCHEMA_VERSION,
        "status": "available",
        "generated_at": datetime.now(UTC).isoformat(),
        "owner": "hakase_smallmol.l3.pipeline",
        "source": {
            "analysis_id": resolved.analysis_id,
            "smiles": resolved.smiles,
            "l1_verdict": resolved.l1_verdict,
            "target": {
                "uniprot_id": resolved.target_uniprot,
                "target_protein": resolved.target_protein,
                "gene_symbol": resolved.target_gene,
            },
            "therapeutic_area": resolved.therapeutic_area,
            "potency": resolved.potency,
        },
        "readiness": readiness(resolved),
        "study_design_options": {
            "species": species_catalog(),
            "routes": list(SUPPORTED_ROUTES),
            "frequencies": list(SUPPORTED_FREQUENCIES),
            "engines": _engine_options(),
            "dose_groups": {
                "note": "Provide a control (dose 0, optional) plus one or more active dose levels in mg/kg.",
                "min_active_groups": 1,
            },
            "formulation": {
                "note": "BCS-driven absorbed-fraction model for oral/SC; ignored for IV.",
            },
            # The guideline envelopes a design is checked against. Exposing the
            # catalogue here lets the workspace show the expectations while the
            # design is still being written; POST /predict/l3/design returns the
            # actual conformance verdict for a specific design.
            "guidelines": [
                {
                    "id": g["id"],
                    "name": g["name"],
                    "duration_window_h": [g["min_duration_h"], g["max_duration_h"]],
                    "animals_per_sex_per_group": g["animals_per_sex_per_group"],
                    "min_dose_groups": g["min_dose_groups"],
                    "control_required": g["control_required"],
                }
                for g in GUIDELINE_EXPECTATIONS
            ],
        },
        "provenance": {
            "source_analysis_id": resolved.analysis_id,
            "client_contract": "display-only",
        },
    }


__all__ = ["l3_input_contract"]
