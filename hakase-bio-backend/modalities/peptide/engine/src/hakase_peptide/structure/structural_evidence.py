"""Structural evidence payload assembly.

This module does not perform scientific calculations. It only gathers the
already-computed structural service outputs into the canonical downstream
evidence object.
"""

from __future__ import annotations

from typing import Any, Literal, cast

STRUCTURAL_EVIDENCE_PROVENANCE = {
    "generator": "structural_evidence_builder",
    "version": "1.0.0",
    "deterministic": True,
}

StructuralValidationStatus = Literal[
    "computational_only",
    "internally_checked",
    "benchmarked",
    "experimentally_validated",
]

SHORT_PEPTIDE_LIMIT = 10

PARTIALLY_SUPPORTED_MODIFICATIONS = {
    "cyclization_head_to_tail",
    "cyclization_side_chain",
    "disulfide",
    "d_amino_acid",
}

UNSUPPORTED_OR_UNRESOLVED_MODIFICATIONS = {
    "n_term_cap",
    "c_term_cap",
    "pegylation",
    "lipidation",
    "unknown",
}


def unavailable_interface_analysis(complex_prediction: dict[str, Any] | None) -> dict[str, Any]:
    """Return an explicit interface-analysis execution state when no analysis ran."""
    status = str((complex_prediction or {}).get("status") or "unavailable")
    if status == "not_applicable":
        return {
            "status": "not_applicable",
            "present": False,
            "reason_code": "target_not_supplied",
        }
    if status == "pending":
        return {
            "status": "pending",
            "present": False,
            "reason_code": "complex_prediction_pending",
        }
    if status == "blocked":
        return {
            "status": "blocked",
            "present": False,
            "reason_code": "complex_prediction_blocked",
        }
    if status == "failed":
        return {
            "status": "failed",
            "present": False,
            "reason_code": "complex_prediction_failed",
        }
    return {
        "status": "unavailable",
        "present": False,
        "reason_code": "interface_analysis_unavailable",
    }


def build_structural_evidence(
    *,
    isolated_structure: dict[str, Any] | None,
    target_resolution: dict[str, Any] | None,
    strategy_selection: dict[str, Any] | None,
    complex_prediction: dict[str, Any] | None,
    interface_analysis: dict[str, Any] | None,
    interface_confidence_summary: dict[str, Any] | None,
    structural_confidence_summary: dict[str, Any] | None,
    peptide_sequence: str | None = None,
    peptide_modifications: list[dict[str, Any]] | None = None,
    disulfide_bridges: list[tuple[int, int]] | list[list[int]] | None = None,
) -> dict[str, Any]:
    """Aggregate existing structural outputs into the standardized evidence object."""

    return {
        "status": _status_from_isolated_structure(isolated_structure),
        "analysis_scope": _analysis_scope_from_structural_summary(structural_confidence_summary),
        "generated_by": "structural_service",
        "schema_version": "1.0.0",
        "validation_status": _validation_status(
            isolated_structure=isolated_structure,
            structural_confidence_summary=structural_confidence_summary,
        ),
        "known_limitations": _known_limitations(
            isolated_structure=isolated_structure,
            target_resolution=target_resolution,
            structural_confidence_summary=structural_confidence_summary,
            peptide_sequence=peptide_sequence,
            peptide_modifications=peptide_modifications,
            disulfide_bridges=disulfide_bridges,
        ),
        "isolated_structure": isolated_structure,
        "target_resolution": target_resolution,
        "strategy_selection": strategy_selection,
        "complex_prediction": complex_prediction,
        "interface_analysis": interface_analysis,
        "interface_confidence_summary": interface_confidence_summary,
        "structural_confidence_summary": structural_confidence_summary,
        "provenance": dict(STRUCTURAL_EVIDENCE_PROVENANCE),
    }


def _analysis_scope_from_structural_summary(
    structural_confidence_summary: dict[str, Any] | None,
) -> str:
    if isinstance(structural_confidence_summary, dict):
        return str(structural_confidence_summary.get("analysis_scope") or "isolated_peptide")
    return "isolated_peptide"


def _status_from_isolated_structure(isolated_structure: dict[str, Any] | None) -> str:
    if isinstance(isolated_structure, dict):
        status = isolated_structure.get("status")
        if status in {"available", "unavailable", "blocked", "pending", "failed", "not_applicable"}:
            return str(status)
        if status == "partial":
            return "available"
        if status in {"error"}:
            return "failed"
        if status in {"skipped"}:
            return "not_applicable"
    return "unavailable"


def _validation_status(
    *,
    isolated_structure: dict[str, Any] | None,
    structural_confidence_summary: dict[str, Any] | None,
) -> StructuralValidationStatus:
    for evidence in _peptide_validation_evidence(
        isolated_structure=isolated_structure,
        structural_confidence_summary=structural_confidence_summary,
    ):
        status = _normalise_validation_status(evidence)
        if status is not None:
            return status
    return "computational_only"


def _peptide_validation_evidence(
    *,
    isolated_structure: dict[str, Any] | None,
    structural_confidence_summary: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    evidence: list[dict[str, Any]] = []
    for payload in (isolated_structure, structural_confidence_summary):
        if not isinstance(payload, dict):
            continue
        for key in (
            "peptide_validation",
            "peptide_validation_evidence",
            "validation_evidence",
            "experimental_peptide_structure",
        ):
            value = payload.get(key)
            if isinstance(value, dict):
                evidence.append(value)
    return evidence


def _normalise_validation_status(
    validation_evidence: dict[str, Any],
) -> StructuralValidationStatus | None:
    status = validation_evidence.get("validation_status") or validation_evidence.get("status")
    if isinstance(status, str):
        canonical = status.strip().lower()
        if canonical in {
            "computational_only",
            "internally_checked",
            "benchmarked",
            "experimentally_validated",
        }:
            return cast(StructuralValidationStatus, canonical)
        if canonical in {
            "experimental",
            "experimental_structure_available",
            "peptide_experimental_structure_available",
        }:
            return "experimentally_validated"
        if canonical in {"internal_verification_completed", "internally_verified"}:
            return "internally_checked"
        if canonical in {"benchmark_validation_completed", "benchmark_completed"}:
            return "benchmarked"

    methods = validation_evidence.get("methods") or validation_evidence.get("method")
    if isinstance(methods, str):
        methods = [methods]
    if isinstance(methods, list):
        canonical_methods = {str(method).strip().lower().replace("_", "-") for method in methods}
        if canonical_methods & {"nmr", "x-ray", "xray", "cryo-em", "cryoem"}:
            return "experimentally_validated"

    if validation_evidence.get("benchmark_id") or validation_evidence.get("benchmark_dataset"):
        return "benchmarked"
    if validation_evidence.get("internal_verification_completed") is True:
        return "internally_checked"
    return None


def _known_limitations(
    *,
    isolated_structure: dict[str, Any] | None,
    target_resolution: dict[str, Any] | None,
    structural_confidence_summary: dict[str, Any] | None,
    peptide_sequence: str | None,
    peptide_modifications: list[dict[str, Any]] | None,
    disulfide_bridges: list[tuple[int, int]] | list[list[int]] | None,
) -> list[dict[str, str]]:
    limitations: list[dict[str, str]] = []

    modification_codes = _modification_codes(peptide_modifications)
    if modification_codes & UNSUPPORTED_OR_UNRESOLVED_MODIFICATIONS:
        _append_limitation(
            limitations,
            "unsupported_or_unresolved_modifications",
            "One or more declared peptide modifications are not directly represented in the structural model.",
        )
    if modification_codes & PARTIALLY_SUPPORTED_MODIFICATIONS or disulfide_bridges:
        _append_limitation(
            limitations,
            "partially_supported_modifications",
            "Declared stereochemical, cyclization, or disulfide constraints are represented only where existing workflow outputs support them.",
        )

    sequence_length = _sequence_length(peptide_sequence, isolated_structure)
    if sequence_length is not None and sequence_length < SHORT_PEPTIDE_LIMIT:
        _append_limitation(
            limitations,
            "short_sequence_limitations",
            f"Peptides shorter than {SHORT_PEPTIDE_LIMIT} residues may have weakly defined single-structure predictions.",
        )

    confidence_summary = _confidence_summary(isolated_structure, structural_confidence_summary)
    if _has_low_confidence_regions(confidence_summary):
        _append_limitation(
            limitations,
            "low_confidence_structural_regions",
            "One or more structural regions have low pLDDT and should be interpreted cautiously.",
        )
    if _is_flexible_or_disordered(confidence_summary):
        _append_limitation(
            limitations,
            "flexible_or_disordered_peptide_uncertainty",
            "pLDDT indicates possible flexible or disordered peptide behavior.",
        )

    if peptide_sequence is not None and _target_missing_or_incomplete(target_resolution):
        _append_limitation(
            limitations,
            "missing_or_incomplete_target_information",
            "Target information is absent or incomplete for peptide-target structural interpretation.",
        )

    return limitations


def _append_limitation(limitations: list[dict[str, str]], code: str, description: str) -> None:
    if any(item["code"] == code for item in limitations):
        return
    limitations.append({"code": code, "description": description})


def _modification_codes(modifications: list[dict[str, Any]] | None) -> set[str]:
    if not modifications:
        return set()
    return {
        str(mod.get("type"))
        for mod in modifications
        if isinstance(mod, dict) and mod.get("type") is not None
    }


def _sequence_length(
    peptide_sequence: str | None, isolated_structure: dict[str, Any] | None
) -> int | None:
    if peptide_sequence is not None:
        return len(peptide_sequence)
    if isinstance(isolated_structure, dict):
        prediction = isolated_structure.get("prediction")
        if isinstance(prediction, dict) and isinstance(prediction.get("n_residues"), int):
            return int(prediction["n_residues"])
    return None


def _confidence_summary(
    isolated_structure: dict[str, Any] | None,
    structural_confidence_summary: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if isinstance(isolated_structure, dict):
        confidence = isolated_structure.get("confidence")
        if isinstance(confidence, dict) and isinstance(confidence.get("summary"), dict):
            return confidence["summary"]
    if isinstance(structural_confidence_summary, dict):
        isolated = structural_confidence_summary.get("isolated_structure_confidence")
        if isinstance(isolated, dict):
            return isolated
    return None


def _has_low_confidence_regions(confidence_summary: dict[str, Any] | None) -> bool:
    if not isinstance(confidence_summary, dict):
        return False
    count = confidence_summary.get("low_confidence_region_count")
    return isinstance(count, int) and count > 0


def _is_flexible_or_disordered(confidence_summary: dict[str, Any] | None) -> bool:
    if not isinstance(confidence_summary, dict):
        return False
    mean = confidence_summary.get("mean_plddt")
    minimum = confidence_summary.get("minimum_plddt")
    low_fraction = confidence_summary.get("low_confidence_residue_fraction")
    return (
        (isinstance(mean, (int, float)) and mean < 50)
        or (isinstance(minimum, (int, float)) and minimum < 50)
        or (isinstance(low_fraction, (int, float)) and low_fraction >= 0.5)
    )


def _target_missing_or_incomplete(target_resolution: dict[str, Any] | None) -> bool:
    if not isinstance(target_resolution, dict):
        return False
    if target_resolution.get("status") == "not_applicable":
        return True
    level = str(target_resolution.get("resolution_level") or "")
    if level in {"none", "identifier_only"}:
        return True
    warnings = target_resolution.get("warnings")
    if isinstance(warnings, list):
        warning_codes = {
            item.get("code")
            for item in warnings
            if isinstance(item, dict) and isinstance(item.get("code"), str)
        }
        return bool(
            warning_codes
            & {
                "target_sequence_unavailable",
                "target_name_only",
                "target_uniprot_lookup_unavailable",
            }
        )
    return False


def _resolved_target(target_resolution: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(target_resolution, dict):
        return {}
    resolved = target_resolution.get("resolved_target")
    if isinstance(resolved, dict):
        return resolved
    input_payload = target_resolution.get("input")
    if isinstance(input_payload, dict):
        return input_payload
    return {}


def _has_value(payload: dict[str, Any], key: str) -> bool:
    value = payload.get(key)
    return value is not None and str(value).strip() != ""
