"""Canonical structural confidence aggregation for peptide structures.

The aggregator consumes already-computed structural evidence and returns one
deterministic summary. It is intentionally conservative: unavailable complex
or interface evidence is reported explicitly but does not make an isolated
peptide prediction look like a provider failure.
"""

from __future__ import annotations

import math
from typing import Any, Literal

ConfidenceLabel = Literal["very_high", "high", "moderate", "low", "very_low", "unavailable"]

PROVENANCE = {
    "calculator": "structural_confidence_aggregator",
    "calculator_version": "1.0.0",
    "ruleset_version": "1.0.0",
    "deterministic": True,
}

INTERFACE_PROVENANCE = {
    "calculator": "interface_confidence_aggregator",
    "calculator_version": "1.0.0",
    "ruleset_version": "1.0.0",
    "deterministic": True,
}

LABEL_SCORES: dict[ConfidenceLabel, int | None] = {
    "very_high": 95,
    "high": 85,
    "moderate": 72,
    "low": 55,
    "very_low": 30,
    "unavailable": None,
}

SCORE_LABELS: tuple[tuple[int, ConfidenceLabel], ...] = (
    (90, "very_high"),
    (80, "high"),
    (70, "moderate"),
    (50, "low"),
    (0, "very_low"),
)

SHORT_PEPTIDE_LENGTH_THRESHOLD = 20

INTERFACE_UNAVAILABLE_WARNING = (
    "Interface confidence cannot be calculated because no peptide-target complex is available."
)

INTERFACE_SECTION_KEYS = (
    "binding_interface_confidence",
    "buried_surface_confidence",
    "interaction_confidence",
    "pose_consistency_confidence",
)


def build_interface_confidence_summary(
    complex_prediction: dict[str, Any] | None,
    interface_analysis: dict[str, Any] | None,
) -> dict[str, Any]:
    """Build a deterministic peptide-target interface confidence summary.

    The summary is intentionally independent from isolated peptide confidence.
    It only reports available evidence when a peptide-target complex exists and
    interface analysis explicitly supplies confidence values.
    """
    if _complex_prediction_not_applicable(complex_prediction):
        return _interface_summary_not_applicable()

    if _complex_prediction_pending(complex_prediction):
        return _interface_summary_pending()

    if _complex_prediction_blocked(complex_prediction) or _interface_analysis_blocked(
        interface_analysis
    ):
        return _interface_summary_blocked()

    if _interface_analysis_failed(interface_analysis):
        return _interface_summary_failed(interface_analysis)

    if not _complex_prediction_available(complex_prediction) or not _interface_analysis_available(
        interface_analysis
    ):
        return _interface_summary_unavailable()

    sections = {
        key: _interface_section(interface_analysis.get(key), key) for key in INTERFACE_SECTION_KEYS
    }
    score = _interface_overall_score(interface_analysis, sections)
    confidence = _normalize_label(interface_analysis.get("overall_confidence"))
    if confidence == "unavailable":
        confidence = _label_for_score(score)
    if score is None and confidence == "unavailable":
        return _interface_summary_unavailable()

    drivers = _string_list(interface_analysis.get("confidence_drivers"))
    warnings = _string_list(interface_analysis.get("warnings"))

    return {
        "status": "available",
        "overall_confidence": confidence,
        "overall_score": score,
        "analysis_scope": "peptide_target_interface",
        **sections,
        "confidence_drivers": drivers,
        "warnings": _dedupe(warnings),
        "provenance": dict(INTERFACE_PROVENANCE),
    }


def build_structural_confidence_summary(
    isolated_structure: dict[str, Any] | None,
    geometry: dict[str, Any] | None,
    confidence_summary: dict[str, Any] | None,
    structural_feasibility: dict[str, Any] | None,
    target_resolution: dict[str, Any] | None,
    complex_prediction: dict[str, Any] | None,
    interface_analysis: dict[str, Any] | None,
) -> dict[str, Any]:
    """Build the canonical peptide structural confidence summary.

    Required keys are always present. Component statuses use the structural
    service canonical statuses so downstream code can distinguish missing
    evidence from negative evidence.
    """
    warnings: list[str] = []
    drivers: list[str] = []

    isolated = _isolated_confidence(isolated_structure, confidence_summary)
    geom = _geometry_confidence(geometry, isolated_structure, confidence_summary)
    feasibility = _feasibility_confidence(structural_feasibility)
    target = _target_confidence(target_resolution)
    complex_conf = _complex_confidence(complex_prediction, target)
    interface = _interface_confidence(interface_analysis, complex_conf)

    _extend(warnings, isolated.pop("_warnings", []))
    _extend(warnings, geom.pop("_warnings", []))
    _extend(warnings, feasibility.pop("_warnings", []))
    _extend(warnings, target.pop("_warnings", []))
    _extend(warnings, complex_conf.pop("_warnings", []))
    _extend(warnings, interface.pop("_warnings", []))
    _extend(drivers, isolated.pop("_drivers", []))
    _extend(drivers, geom.pop("_drivers", []))
    _extend(drivers, feasibility.pop("_drivers", []))
    _extend(drivers, complex_conf.pop("_drivers", []))
    _extend(drivers, interface.pop("_drivers", []))

    if complex_conf["status"] in {"unavailable", "not_applicable", "pending", "failed"}:
        warnings.append(
            "Overall structural confidence is based primarily on isolated peptide evidence; "
            "peptide-target complex confidence is not available."
        )
    if interface["status"] in {"unavailable", "not_applicable", "pending", "failed"}:
        warnings.append(
            "Interface confidence was not included because no interface evidence is available."
        )

    score = _weighted_isolated_score(isolated, geom, feasibility)
    status = "available" if score is not None else "unavailable"
    if isolated["status"] == "failed":
        status = "failed"
    elif isolated["status"] == "pending":
        status = "pending"

    overall = _label_for_score(score)
    score = _apply_scientific_caps(
        score,
        isolated,
        geom,
        feasibility,
        complex_conf,
        interface,
        warnings,
    )
    overall = _label_for_score(score)
    evidence_quality = _evidence_quality(isolated, geom, feasibility, score)
    overall, evidence_quality = _apply_short_isolated_interpretation_cap(
        overall,
        evidence_quality,
        isolated,
        complex_conf,
        interface,
    )
    scope = _analysis_scope(target, complex_conf)

    return {
        "status": status,
        "overall_confidence": overall,
        "overall_score": score,
        "evidence_quality": evidence_quality,
        "analysis_scope": scope,
        "isolated_structure_confidence": isolated,
        "geometry_confidence": geom,
        "feasibility_confidence": feasibility,
        "target_confidence": target,
        "complex_confidence": complex_conf,
        "interface_confidence": interface,
        "confidence_drivers": drivers,
        "warnings": _dedupe(warnings),
        "provenance": dict(PROVENANCE),
    }


def _isolated_confidence(
    isolated_structure: dict[str, Any] | None,
    confidence_summary: dict[str, Any] | None,
) -> dict[str, Any]:
    status = _status(isolated_structure)
    if status in {"unavailable", "error", "failed"}:
        reason = _reason(isolated_structure) or "isolated_structure_unavailable"
        failed = "failed" in reason or status in {"error", "failed"}
        return {
            "status": "failed" if failed else "unavailable",
            "confidence": "unavailable",
            "score": None,
            "mean_plddt": None,
            "n_residues": None,
            "reason_code": reason,
            "_warnings": ["Isolated peptide structure prediction is unavailable."],
        }

    mean = _first_number(
        _get(confidence_summary, "mean_plddt"),
        _get(isolated_structure, "prediction", "mean_plddt"),
    )
    n_residues = _first_int(
        _get(confidence_summary, "total_residues"),
        _get(isolated_structure, "prediction", "n_residues"),
    )
    if mean is None:
        return {
            "status": "unavailable",
            "confidence": "unavailable",
            "score": None,
            "mean_plddt": None,
            "n_residues": n_residues,
            "reason_code": "mean_plddt_unavailable",
            "_warnings": ["Mean pLDDT is unavailable for isolated peptide confidence."],
        }
    label = _plddt_label(mean)
    return {
        "status": "available",
        "confidence": label,
        "score": int(round(mean)),
        "mean_plddt": round(mean, 2),
        "n_residues": n_residues,
        "_drivers": [f"Isolated peptide mean pLDDT supports {label} confidence."],
    }


def _geometry_confidence(
    geometry: dict[str, Any] | None,
    isolated_structure: dict[str, Any] | None,
    confidence_summary: dict[str, Any] | None,
) -> dict[str, Any]:
    if not isinstance(geometry, dict) or geometry.get("status") == "unavailable":
        return {
            "status": "unavailable",
            "confidence": "unavailable",
            "score": None,
            "reason_code": _reason(geometry) or "geometry_unavailable",
            "_warnings": ["Coordinate-derived geometry is unavailable."],
        }

    score = 85
    warnings: list[str] = []
    drivers = ["Coordinate-derived geometry is available."]
    counts = [
        _get(isolated_structure, "prediction", "n_residues"),
        geometry.get("n_residues"),
        _get(confidence_summary, "total_residues"),
    ]
    int_counts = [int(v) for v in counts if isinstance(v, int)]
    if len(set(int_counts)) > 1:
        score -= 35
        warnings.append(
            "Residue counts differ between structure, geometry, and confidence evidence."
        )
    numeric_fields = (
        "radius_of_gyration_angstrom",
        "end_to_end_distance_angstrom",
        "compactness_ratio",
        "mean_plddt",
        "min_plddt",
        "max_plddt",
    )
    invalid = [
        name
        for name in numeric_fields
        if name in geometry and not _valid_optional_number(geometry.get(name))
    ]
    if invalid:
        score -= 40
        warnings.append("Geometry contains invalid numeric values.")
    fraction = _number(geometry.get("confident_residue_fraction"))
    if fraction is not None:
        score = min(score, int(round(50 + 50 * fraction)))
    score = _clamp(score)
    return {
        "status": "available",
        "confidence": _label_for_score(score),
        "score": score,
        "n_residues": geometry.get("n_residues"),
        "confident_residue_fraction": fraction,
        "_warnings": warnings,
        "_drivers": drivers,
    }


def _feasibility_confidence(feasibility: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(feasibility, dict):
        return {
            "status": "unavailable",
            "confidence": "unavailable",
            "score": None,
            "reason_code": "structural_feasibility_unavailable",
            "_warnings": ["Structural feasibility assessment is unavailable."],
        }
    status = str(feasibility.get("status") or "unavailable")
    raw_score = _number(feasibility.get("score"))
    if raw_score is None:
        return {
            "status": "unavailable",
            "confidence": "unavailable",
            "score": None,
            "feasibility_status": status,
            "risk_level": feasibility.get("risk_level"),
            "_warnings": ["Structural feasibility did not produce a score."],
        }
    score = _clamp(raw_score)
    if status == "not_feasible":
        score = min(score, 45)
    elif status == "insufficient_evidence":
        score = min(score, 49)
    return {
        "status": "available",
        "confidence": _label_for_score(score),
        "score": score,
        "feasibility_status": status,
        "decision": feasibility.get("decision"),
        "risk_level": feasibility.get("risk_level"),
        "_drivers": [f"Structural feasibility status is {status}."],
        "_warnings": (
            ["Structural feasibility rejects the isolated structure."]
            if status == "not_feasible"
            else []
        ),
    }


def _target_confidence(target_resolution: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(target_resolution, dict) or target_resolution.get("status") in {
        "not_provided",
        "not_applicable",
    }:
        return {
            "status": "not_applicable",
            "confidence": "unavailable",
            "score": None,
            "reason_code": "target_not_supplied",
            "_warnings": ["No target was supplied; target-dependent confidence is not applicable."],
        }
    status = str(target_resolution.get("status") or "unavailable")
    if status in {"available", "resolved", "partially_resolved"}:
        label = str(target_resolution.get("confidence") or "moderate")
        score = _label_score(label)
        return {
            "status": "available",
            "confidence": _normalize_label(label),
            "score": score,
            "resolution_status": status,
            "resolution_level": target_resolution.get("resolution_level"),
        }
    mapped = (
        "blocked"
        if status in {"blocked", "unresolved"}
        else "failed" if status in {"failed", "error"} else "unavailable"
    )
    return {
        "status": mapped,
        "confidence": "unavailable",
        "score": None,
        "resolution_status": status,
        "reason_code": "target_resolution_unavailable",
    }


def _complex_confidence(
    complex_prediction: dict[str, Any] | None,
    target_confidence: dict[str, Any],
) -> dict[str, Any]:
    if target_confidence["status"] == "not_applicable":
        return {
            "status": "not_applicable",
            "confidence": "unavailable",
            "score": None,
            "reason_code": "target_not_supplied",
        }
    if not isinstance(complex_prediction, dict):
        return {
            "status": "unavailable",
            "confidence": "unavailable",
            "score": None,
            "reason_code": "complex_prediction_unavailable",
            "_warnings": ["Complex prediction evidence is unavailable."],
        }
    status = str(complex_prediction.get("status") or "unavailable")
    if status in {"available", "completed"} and complex_prediction.get("complex_available") is True:
        label = _normalize_label(complex_prediction.get("confidence"))
        return {
            "status": "available",
            "confidence": label,
            "score": _label_score(label),
            "provider": complex_prediction.get("provider"),
            "model_version": complex_prediction.get("model_version"),
            "_drivers": ["Peptide-target complex prediction is available."],
        }
    mapped = (
        "pending"
        if status == "pending"
        else "blocked" if status == "blocked" else "failed" if status == "failed" else "unavailable"
    )
    reason = _first_message_code(complex_prediction.get("warnings")) or _first_message_code(
        complex_prediction.get("errors")
    )
    return {
        "status": mapped,
        "confidence": "unavailable",
        "score": None,
        "provider": complex_prediction.get("provider"),
        "model_version": complex_prediction.get("model_version"),
        "reason_code": reason or f"complex_prediction_{status}",
        "_warnings": [f"Complex prediction is {status}; no complex confidence was inferred."],
    }


def _interface_confidence(
    interface_analysis: dict[str, Any] | None,
    complex_confidence: dict[str, Any],
) -> dict[str, Any]:
    if complex_confidence["status"] == "not_applicable":
        return {
            "status": "not_applicable",
            "confidence": "unavailable",
            "score": None,
            "reason_code": "complex_not_applicable",
        }
    if complex_confidence["status"] == "blocked":
        return {
            "status": "blocked",
            "confidence": "unavailable",
            "score": None,
            "reason_code": "complex_prediction_blocked",
        }
    if not isinstance(interface_analysis, dict) or interface_analysis.get("present") is not True:
        status = _status(interface_analysis)
        if status in {"blocked", "pending", "failed"}:
            return {
                "status": status,
                "confidence": "unavailable",
                "score": None,
                "reason_code": _reason(interface_analysis) or f"interface_analysis_{status}",
            }
        return {
            "status": "unavailable",
            "confidence": "unavailable",
            "score": None,
            "reason_code": _reason(interface_analysis) or "interface_analysis_unavailable",
        }
    score = 75
    if _number(interface_analysis.get("buried_surface_area")) is not None:
        score += 5
    if _number(interface_analysis.get("shape_complementarity")) is not None:
        score += 5
    score = _clamp(score)
    return {
        "status": "available",
        "confidence": _label_for_score(score),
        "score": score,
        "contact_residue_count": sum(
            len(v) for v in (interface_analysis.get("contact_residues") or {}).values()
        ),
        "_drivers": ["Interface analysis is available."],
    }


def _interface_summary_unavailable() -> dict[str, Any]:
    return {
        "status": "unavailable",
        "overall_confidence": "unavailable",
        "overall_score": None,
        "analysis_scope": "peptide_target_interface",
        "interface_available": False,
        "reason_code": "interface_analysis_unavailable",
        "confidence_drivers": [],
        "warnings": [INTERFACE_UNAVAILABLE_WARNING],
        "provenance": dict(INTERFACE_PROVENANCE),
    }


def _interface_summary_not_applicable() -> dict[str, Any]:
    return {
        "status": "not_applicable",
        "overall_confidence": "unavailable",
        "overall_score": None,
        "analysis_scope": "peptide_target_interface",
        "interface_available": False,
        "reason_code": "target_not_supplied",
        "confidence_drivers": [],
        "warnings": ["Interface confidence is not applicable because no target was supplied."],
        "provenance": dict(INTERFACE_PROVENANCE),
    }


def _interface_summary_pending() -> dict[str, Any]:
    return {
        "status": "pending",
        "overall_confidence": "unavailable",
        "overall_score": None,
        "analysis_scope": "peptide_target_interface",
        "interface_available": False,
        "reason_code": "interface_analysis_pending",
        "confidence_drivers": [],
        "warnings": [
            "Interface confidence is pending until peptide-target interface analysis completes."
        ],
        "provenance": dict(INTERFACE_PROVENANCE),
    }


def _interface_summary_blocked() -> dict[str, Any]:
    return {
        "status": "blocked",
        "overall_confidence": "unavailable",
        "overall_score": None,
        "analysis_scope": "peptide_target_interface",
        "interface_available": False,
        "reason_code": "complex_prediction_blocked",
        "confidence_drivers": [],
        "warnings": [
            "Interface confidence is blocked until complex prediction inputs are complete."
        ],
        "provenance": dict(INTERFACE_PROVENANCE),
    }


def _interface_summary_failed(interface_analysis: dict[str, Any] | None) -> dict[str, Any]:
    reason = _reason(interface_analysis) or "interface_analysis_failed"
    return {
        "status": "failed",
        "overall_confidence": "unavailable",
        "overall_score": None,
        "analysis_scope": "peptide_target_interface",
        "interface_available": False,
        "reason_code": reason,
        "confidence_drivers": [],
        "warnings": [
            "Interface confidence could not be calculated because interface analysis failed."
        ],
        "provenance": dict(INTERFACE_PROVENANCE),
    }


def _complex_prediction_available(complex_prediction: dict[str, Any] | None) -> bool:
    return (
        isinstance(complex_prediction, dict)
        and complex_prediction.get("status") in {"available", "completed"}
        and complex_prediction.get("complex_available") is True
    )


def _complex_prediction_pending(complex_prediction: dict[str, Any] | None) -> bool:
    return isinstance(complex_prediction, dict) and complex_prediction.get("status") == "pending"


def _complex_prediction_blocked(complex_prediction: dict[str, Any] | None) -> bool:
    return isinstance(complex_prediction, dict) and complex_prediction.get("status") == "blocked"


def _complex_prediction_not_applicable(complex_prediction: dict[str, Any] | None) -> bool:
    if not isinstance(complex_prediction, dict):
        return False
    return complex_prediction.get("status") == "not_applicable" or (
        complex_prediction.get("reason_code") == "target_not_supplied"
    )


def _interface_analysis_available(interface_analysis: dict[str, Any] | None) -> bool:
    if not isinstance(interface_analysis, dict):
        return False
    status = interface_analysis.get("status")
    return status == "available" or interface_analysis.get("present") is True


def _interface_analysis_failed(interface_analysis: dict[str, Any] | None) -> bool:
    if not isinstance(interface_analysis, dict):
        return False
    status = str(interface_analysis.get("status") or "")
    reason = _reason(interface_analysis) or ""
    return status in {"failed", "error"} or "failed" in reason


def _interface_analysis_blocked(interface_analysis: dict[str, Any] | None) -> bool:
    return isinstance(interface_analysis, dict) and interface_analysis.get("status") == "blocked"


def _interface_section(section: Any, key: str) -> dict[str, Any]:
    if not isinstance(section, dict) or section.get("status") != "available":
        return {
            "status": "unavailable",
            "confidence": "unavailable",
            "score": None,
            "reason_code": f"{key}_unavailable",
        }
    score = _score_or_none(section.get("score"))
    confidence = _normalize_label(section.get("confidence"))
    if confidence == "unavailable":
        confidence = _label_for_score(score)
    return {
        **section,
        "status": "available",
        "confidence": confidence,
        "score": score,
    }


def _interface_overall_score(
    interface_analysis: dict[str, Any],
    sections: dict[str, dict[str, Any]],
) -> int | None:
    explicit_score = _score_or_none(interface_analysis.get("overall_score"))
    if explicit_score is not None:
        return explicit_score
    scores = [
        section["score"]
        for section in sections.values()
        if isinstance(section.get("score"), int | float)
    ]
    if not scores:
        return None
    return _clamp(sum(scores) / len(scores))


def _score_or_none(value: Any) -> int | None:
    number = _number(value)
    if number is None:
        return None
    return _clamp(number)


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if isinstance(item, str) and item]


def _weighted_isolated_score(
    isolated: dict[str, Any], geometry: dict[str, Any], feasibility: dict[str, Any]
) -> int | None:
    if isolated.get("score") is None:
        return None
    weighted = 0.5 * float(isolated["score"])
    total_weight = 0.5
    if geometry.get("score") is not None:
        weighted += 0.2 * float(geometry["score"])
        total_weight += 0.2
    if feasibility.get("score") is not None:
        weighted += 0.3 * float(feasibility["score"])
        total_weight += 0.3
    return _clamp(weighted / total_weight)


def _apply_scientific_caps(
    score: int | None,
    isolated: dict[str, Any],
    geometry: dict[str, Any],
    feasibility: dict[str, Any],
    complex_confidence: dict[str, Any],
    interface_confidence: dict[str, Any],
    warnings: list[str],
) -> int | None:
    if score is None:
        return None
    if isolated.get("n_residues") is not None and isolated["n_residues"] < 8:
        if (
            complex_confidence["status"] != "available"
            or interface_confidence["status"] != "available"
        ):
            if score > 79:
                warnings.append(
                    "Very short isolated peptide predictions are capped at moderate confidence "
                    "without strong complex and interface evidence."
                )
            score = min(score, 79)
    if (
        complex_confidence["status"] != "available"
        and interface_confidence["status"] != "available"
    ):
        isolated_score = isolated.get("score")
        if isinstance(isolated_score, int | float) and 80 <= isolated_score < 90:
            score = min(score, 89)
    if geometry.get("confidence") in {"low", "very_low"}:
        score = min(score, 69)
    if feasibility.get("feasibility_status") == "not_feasible":
        score = min(score, 45)
    return _clamp(score)


def _analysis_scope(target: dict[str, Any], complex_confidence: dict[str, Any]) -> str:
    if complex_confidence["status"] == "available":
        return "peptide_target_complex"
    if target["status"] == "available":
        return "isolated_peptide_with_target_context"
    return "isolated_peptide"


def _evidence_quality(
    isolated: dict[str, Any],
    geometry: dict[str, Any],
    feasibility: dict[str, Any],
    score: int | None,
) -> str:
    if score is None or isolated["status"] != "available":
        return "insufficient"
    available = sum(
        1 for component in (isolated, geometry, feasibility) if component["status"] == "available"
    )
    if available == 3 and score >= 80:
        return "high"
    if available >= 2 and score >= 60:
        return "moderate"
    return "low"


def _apply_short_isolated_interpretation_cap(
    overall_confidence: ConfidenceLabel,
    evidence_quality: str,
    isolated: dict[str, Any],
    complex_confidence: dict[str, Any],
    interface_confidence: dict[str, Any],
) -> tuple[ConfidenceLabel, str]:
    n_residues = isolated.get("n_residues")
    if not isinstance(n_residues, int) or n_residues >= SHORT_PEPTIDE_LENGTH_THRESHOLD:
        return overall_confidence, evidence_quality
    if complex_confidence.get("status") == "available":
        return overall_confidence, evidence_quality
    if interface_confidence.get("status") not in {"unavailable", "not_applicable"}:
        return overall_confidence, evidence_quality

    capped_confidence = (
        "moderate" if overall_confidence in {"very_high", "high"} else overall_confidence
    )
    capped_quality = "moderate" if evidence_quality == "high" else evidence_quality
    return capped_confidence, capped_quality


def _plddt_label(plddt: float) -> ConfidenceLabel:
    if plddt >= 90:
        return "very_high"
    if plddt >= 80:
        return "high"
    if plddt >= 70:
        return "moderate"
    if plddt >= 50:
        return "low"
    return "very_low"


def _label_for_score(score: int | float | None) -> ConfidenceLabel:
    if score is None:
        return "unavailable"
    value = float(score)
    for threshold, label in SCORE_LABELS:
        if value >= threshold:
            return label
    return "very_low"


def _normalize_label(value: Any) -> ConfidenceLabel:
    if isinstance(value, str):
        lowered = value.lower()
        if lowered in {"very_high", "high", "moderate", "low", "very_low"}:
            return lowered  # type: ignore[return-value]
        if lowered in {"confident", "medium"}:
            return "moderate"
    return "unavailable"


def _label_score(value: Any) -> int | None:
    return LABEL_SCORES[_normalize_label(value)]


def _status(payload: dict[str, Any] | None) -> str:
    if not isinstance(payload, dict):
        return "unavailable"
    return str(payload.get("status") or "available")


def _reason(payload: dict[str, Any] | None) -> str | None:
    if not isinstance(payload, dict):
        return None
    value = payload.get("reason_code") or payload.get("reason")
    return str(value) if value else None


def _get(payload: dict[str, Any] | None, *path: str) -> Any:
    current: Any = payload
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _first_number(*values: Any) -> float | None:
    for value in values:
        number = _number(value)
        if number is not None:
            return number
    return None


def _first_int(*values: Any) -> int | None:
    for value in values:
        if isinstance(value, int) and not isinstance(value, bool):
            return value
    return None


def _number(value: Any) -> float | None:
    if isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value):
        return float(value)
    return None


def _valid_optional_number(value: Any) -> bool:
    return value is None or _number(value) is not None


def _first_message_code(messages: Any) -> str | None:
    if not isinstance(messages, list):
        return None
    for item in messages:
        if isinstance(item, dict) and item.get("code"):
            return str(item["code"])
    return None


def _clamp(value: int | float) -> int:
    return max(0, min(100, int(round(float(value)))))


def _extend(target: list[str], values: Any) -> None:
    if isinstance(values, list):
        target.extend(str(value) for value in values if value)


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result
