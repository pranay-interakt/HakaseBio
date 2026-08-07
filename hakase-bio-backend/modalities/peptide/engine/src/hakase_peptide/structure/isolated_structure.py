"""Standardized isolated peptide structure API payloads."""

from __future__ import annotations

from typing import Any, Literal

from hakase_structure.pdb_tools import has_coordinate_records, parsed_residue_count
from hakase_structure.prediction import StructurePrediction

from .structural_feasibility import unavailable_structural_feasibility

IsolatedStructureStatus = Literal[
    "available", "unavailable", "blocked", "pending", "failed", "not_applicable"
]
PDBOutputStatus = Literal["available", "not_requested", "unavailable", "error"]

ISOLATED_STRUCTURE_LIMITATIONS: list[dict[str, str]] = [
    {
        "code": "isolated_peptide_prediction_only",
        "description": "Phase 1 predicts the peptide as an isolated single chain.",
    },
    {
        "code": "no_target_bound_complex_prediction",
        "description": "Target-bound peptide complexes are not part of this isolated structure result.",
    },
    {
        "code": "model_derived_confidence_not_experimental",
        "description": "pLDDT confidence is model-derived and is not experimental validation.",
    },
    {
        "code": "short_flexible_peptides_uncertain",
        "description": "Short or flexible peptides may have uncertain conformations.",
    },
    {
        "code": "no_phase1_molecular_dynamics_validation",
        "description": "Phase 1 does not include molecular dynamics validation.",
    },
]


def build_isolated_structure(
    *,
    prediction: StructurePrediction,
    structure: dict[str, Any],
    geometry: dict[str, Any] | None,
    confidence_report: dict[str, Any],
    pdb_output: dict[str, Any],
) -> dict[str, Any]:
    """Assemble the additive isolated_structure object from existing outputs."""
    confidence_summary = confidence_report["confidence_summary"]
    status: IsolatedStructureStatus = "available"
    reason_code = None
    if confidence_summary.get("status") == "unavailable":
        status = "unavailable"
        reason_code = confidence_summary.get("reason_code", "per_residue_confidence_unavailable")
    if pdb_output.get("status") == "unavailable":
        status = "unavailable"
        reason_code = reason_code or pdb_output.get("reason_code", "pdb_content_unavailable")

    provenance = _provenance_from_prediction(prediction, structure)
    payload: dict[str, Any] = {
        "status": status,
        "prediction": _prediction_from_structure(structure),
        "geometry": _standardized_geometry(geometry) if geometry is not None else None,
        "confidence": {
            "per_residue": confidence_report["per_residue_confidence"],
            "low_confidence_regions": confidence_report["low_confidence_regions"],
            "summary": confidence_summary,
        },
        "pdb": pdb_output,
        "provenance": provenance,
        "limitations": list(ISOLATED_STRUCTURE_LIMITATIONS),
    }
    if reason_code:
        payload["reason_code"] = reason_code
    return payload


def unavailable_isolated_structure(
    *,
    provider: str,
    reason_code: str,
    reason_detail: str,
    include_pdb: bool = True,
    model_id: str = "esmfold_v1",
    model_version: str = "1.0.0",
) -> dict[str, Any]:
    """Machine-readable isolated structure block for bounded structure failures."""
    pdb_status: PDBOutputStatus = "unavailable" if include_pdb else "not_requested"
    pdb_output: dict[str, Any] = {
        "status": pdb_status,
        "format": "pdb",
        "content": None,
    }
    if include_pdb:
        pdb_output.update(
            {
                "reason_code": reason_code,
                "reason_detail": reason_detail,
            }
        )
    feasibility = unavailable_structural_feasibility(
        reason_code=reason_code,
        pdb_output=pdb_output,
        include_pdb=include_pdb,
        isolated_structure_status="unavailable",
    )
    return {
        "status": "unavailable",
        "reason_code": reason_code,
        "reason_detail": reason_detail,
        "prediction": None,
        "geometry": None,
        "confidence": None,
        "pdb": pdb_output,
        "structural_feasibility": feasibility,
        "provenance": {
            "provider": provider,
            "model_id": model_id,
            "model_version": model_version,
            "plddt_scale": "0-100",
            "raw_plddt_scale": None,
        },
        "limitations": list(ISOLATED_STRUCTURE_LIMITATIONS),
    }


def build_pdb_output(
    *,
    prediction: StructurePrediction,
    include_pdb: bool,
    structure: dict[str, Any],
    geometry: dict[str, Any] | None,
    confidence_summary: dict[str, Any] | None,
) -> dict[str, Any]:
    """Build the single source of truth for public PDB content exposure."""
    base: dict[str, Any] = {
        "status": "not_requested",
        "format": "pdb",
        "content": None,
    }
    if not include_pdb:
        return base

    pdb = prediction.pdb
    if not isinstance(pdb, str) or not pdb.strip() or not has_coordinate_records(pdb):
        return {
            **base,
            "status": "unavailable",
            "reason_code": "pdb_content_unavailable",
        }

    parsed_count = parsed_residue_count(pdb)
    expected_counts = _expected_residue_counts(structure, geometry, confidence_summary)
    if parsed_count <= 0:
        return {
            **base,
            "status": "unavailable",
            "reason_code": "pdb_residue_count_unavailable",
        }
    if expected_counts and any(parsed_count != count for count in expected_counts):
        return {
            **base,
            "status": "unavailable",
            "reason_code": "pdb_residue_count_mismatch",
            "n_residues": parsed_count,
            "expected_n_residues": expected_counts[0],
        }

    return {
        "status": "available",
        "format": "pdb",
        "content": pdb,
        "content_encoding": "plain_text",
        "n_residues": parsed_count,
        "byte_length": len(pdb.encode("utf-8")),
        "provider": structure["provider"],
        "model_id": structure["model_id"],
        "model_version": structure["model_version"],
    }


def _prediction_from_structure(structure: dict[str, Any]) -> dict[str, Any]:
    return {
        "provider": structure["provider"],
        "model_id": structure["model_id"],
        "model_version": structure["model_version"],
        "n_residues": structure["n_residues"],
        "mean_plddt": structure["mean_plddt"],
        "plddt_scale": structure["plddt_scale"],
        "raw_plddt_scale": structure["raw_plddt_scale"],
    }


def _provenance_from_prediction(
    prediction: StructurePrediction, structure: dict[str, Any]
) -> dict[str, Any]:
    return {
        "provider": prediction.provider,
        "model_id": prediction.model_id,
        "model_version": prediction.model_version,
        "plddt_scale": structure["plddt_scale"],
        "raw_plddt_scale": prediction.raw_plddt_scale,
    }


def _standardized_geometry(geometry: dict[str, Any]) -> dict[str, Any]:
    return {
        "n_residues": geometry["n_residues"],
        "mean_plddt": geometry["mean_plddt"],
        "minimum_plddt": geometry["min_plddt"],
        "maximum_plddt": geometry["max_plddt"],
        "plddt_scale": geometry.get("plddt_scale", "0-100"),
        "confident_residue_fraction": geometry["confident_residue_fraction"],
        "radius_of_gyration_angstrom": geometry["radius_of_gyration_angstrom"],
        "end_to_end_distance_angstrom": geometry["end_to_end_distance_angstrom"],
        "compactness_ratio": geometry["compactness_ratio"],
        "disulfide_geometry": geometry["disulfide_geometry"],
    }


def _expected_residue_counts(
    structure: dict[str, Any],
    geometry: dict[str, Any] | None,
    confidence_summary: dict[str, Any] | None,
) -> list[int]:
    counts: list[int] = []
    for value in (
        structure.get("n_residues"),
        geometry.get("n_residues") if geometry is not None else None,
        confidence_summary.get("total_residues") if confidence_summary is not None else None,
    ):
        if isinstance(value, int) and value >= 0 and value not in counts:
            counts.append(value)
    return counts
