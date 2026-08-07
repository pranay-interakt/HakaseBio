"""Deterministic structural feasibility triage for isolated peptide structures."""

from __future__ import annotations

import math
from typing import Any

from ..domain.schemas.structural import (
    StructuralFeasibilityDecision,
    StructuralFeasibilityEvidenceQuality,
    StructuralFeasibilityMetrics,
    StructuralFeasibilityReason,
    StructuralFeasibilityRecommendation,
    StructuralFeasibilityResult,
    StructuralFeasibilityRisk,
    StructuralFeasibilityRiskLevel,
    StructuralFeasibilityRule,
    StructuralFeasibilityRuleOutcome,
    StructuralFeasibilitySeverity,
    StructuralFeasibilityStatus,
)

BASE_SCORE = 100
LONG_LOW_CONFIDENCE_REGION_MIN_LENGTH = 4
LONG_LOW_CONFIDENCE_REGION_FRACTION = 0.25
COMPACTNESS_CAUTION_RANGE = (0.25, 4.0)
COMPACTNESS_FAIL_RANGE = (0.10, 8.0)
DISULFIDE_MAX_SG_DISTANCE_ANGSTROM = 2.5


def build_structural_feasibility(
    *,
    structure: dict[str, Any] | None,
    geometry: dict[str, Any] | None,
    confidence_summary: dict[str, Any] | None,
    low_confidence_regions: list[dict[str, Any]] | None,
    requested_disulfides: list[tuple[int, int]] | tuple[tuple[int, int], ...] | None,
    pdb_output: dict[str, Any] | None,
    include_pdb: bool,
    isolated_structure_status: str | None = None,
) -> dict[str, Any]:
    """Build one shared feasibility object from already-computed evidence.

    Minimum evidence required for scoring is: a valid prediction mean pLDDT,
    positive prediction residue count, usable confidence summary, and basic
    geometry. Missing required evidence yields insufficient_evidence with no
    score rather than a confident failure.
    """
    requested = [tuple(pair) for pair in (requested_disulfides or [])]
    metrics = _metrics(
        structure=structure,
        geometry=geometry,
        confidence_summary=confidence_summary,
        requested_disulfide_count=len(requested),
        pdb_output=pdb_output,
        isolated_structure_status=isolated_structure_status,
    )
    reasons: list[StructuralFeasibilityReason] = []
    risks: list[StructuralFeasibilityRisk] = []
    recommendations: list[StructuralFeasibilityRecommendation] = []
    rules: list[StructuralFeasibilityRule] = []

    required_missing = _required_evidence_gaps(structure, geometry, confidence_summary)
    if required_missing:
        for code, message in required_missing:
            _risk(risks, code, StructuralFeasibilitySeverity.HIGH, message)
        _recommend(recommendations, "rerun_when_structural_evidence_available")
        _rule(rules, "evidence.minimum_required", StructuralFeasibilityRuleOutcome.UNAVAILABLE)
        result = StructuralFeasibilityResult(
            status=StructuralFeasibilityStatus.INSUFFICIENT_EVIDENCE,
            decision=StructuralFeasibilityDecision.REVIEW_REQUIRED,
            score=None,
            risk_level=StructuralFeasibilityRiskLevel.UNKNOWN,
            evidence_quality=StructuralFeasibilityEvidenceQuality.INSUFFICIENT,
            reasons=reasons,
            risks=risks,
            recommendations=recommendations,
            metrics=metrics,
            rules_triggered=rules,
        )
        return result.model_dump(mode="json")

    score = BASE_SCORE
    score += _confidence_rules(metrics, reasons, risks, rules)
    score += _region_rules(metrics, low_confidence_regions or [], risks, rules)
    score += _geometry_rules(geometry, metrics, reasons, risks, rules)
    score += _disulfide_rules(requested, geometry, reasons, risks, rules)
    _pdb_rule(include_pdb, pdb_output, risks, rules)

    score = max(0, min(100, int(round(score))))
    status, decision, risk_level = _classification(score)
    evidence_quality = _evidence_quality(score, metrics, risks, include_pdb, pdb_output)
    _recommendations_for_result(score, risks, recommendations)

    result = StructuralFeasibilityResult(
        status=status,
        decision=decision,
        score=score,
        risk_level=risk_level,
        evidence_quality=evidence_quality,
        reasons=reasons,
        risks=risks,
        recommendations=recommendations,
        metrics=metrics,
        rules_triggered=rules,
    )
    return result.model_dump(mode="json")


def unavailable_structural_feasibility(
    *,
    reason_code: str,
    pdb_output: dict[str, Any] | None = None,
    include_pdb: bool = True,
    isolated_structure_status: str | None = "unavailable",
) -> dict[str, Any]:
    """Feasibility object for bounded structure-prediction failures."""
    return build_structural_feasibility(
        structure={"status": "unavailable", "reason_code": reason_code},
        geometry=None,
        confidence_summary=None,
        low_confidence_regions=[],
        requested_disulfides=[],
        pdb_output=pdb_output,
        include_pdb=include_pdb,
        isolated_structure_status=isolated_structure_status,
    )


def _metrics(
    *,
    structure: dict[str, Any] | None,
    geometry: dict[str, Any] | None,
    confidence_summary: dict[str, Any] | None,
    requested_disulfide_count: int,
    pdb_output: dict[str, Any] | None,
    isolated_structure_status: str | None,
) -> StructuralFeasibilityMetrics:
    structure_n = _int(structure, "n_residues")
    geometry_n = _int(geometry, "n_residues")
    confidence_n = _int(confidence_summary, "total_residues")
    disulfides = geometry.get("disulfide_geometry") if isinstance(geometry, dict) else []
    validated_disulfides = sum(
        1 for item in disulfides or [] if item.get("geometry_consistent") is True
    )
    return StructuralFeasibilityMetrics(
        mean_plddt=_first_finite(
            _number(confidence_summary, "mean_plddt"),
            _number(geometry, "mean_plddt"),
            _number(structure, "mean_plddt"),
        ),
        minimum_plddt=_first_finite(
            _number(confidence_summary, "minimum_plddt"),
            _number(geometry, "min_plddt"),
        ),
        maximum_plddt=_first_finite(
            _number(confidence_summary, "maximum_plddt"),
            _number(geometry, "max_plddt"),
        ),
        confident_residue_fraction=_number(geometry, "confident_residue_fraction"),
        low_confidence_residue_fraction=_number(
            confidence_summary, "low_confidence_residue_fraction"
        ),
        low_confidence_region_count=_int(confidence_summary, "low_confidence_region_count"),
        n_residues=structure_n,
        structure_n_residues=structure_n,
        geometry_n_residues=geometry_n,
        confidence_n_residues=confidence_n,
        radius_of_gyration_angstrom=_number(geometry, "radius_of_gyration_angstrom"),
        end_to_end_distance_angstrom=_number(geometry, "end_to_end_distance_angstrom"),
        compactness_ratio=_number(geometry, "compactness_ratio"),
        requested_disulfide_count=requested_disulfide_count,
        validated_disulfide_count=validated_disulfides,
        pdb_status=pdb_output.get("status") if isinstance(pdb_output, dict) else None,
        isolated_structure_status=isolated_structure_status,
    )


def _required_evidence_gaps(
    structure: dict[str, Any] | None,
    geometry: dict[str, Any] | None,
    confidence_summary: dict[str, Any] | None,
) -> list[tuple[str, str]]:
    gaps: list[tuple[str, str]] = []
    if not isinstance(structure, dict) or structure.get("status") == "unavailable":
        gaps.append(("prediction_unavailable", "Structure prediction is unavailable."))
    elif not _is_finite(structure.get("mean_plddt")) or not _positive_int(
        structure.get("n_residues")
    ):
        gaps.append(
            (
                "prediction_unavailable",
                "Structure prediction lacks valid mean pLDDT or residue count.",
            )
        )

    if not isinstance(geometry, dict) or geometry.get("status") == "unavailable":
        gaps.append(("geometry_missing", "Coordinate-derived geometry is unavailable."))
    elif not _positive_int(geometry.get("n_residues")):
        gaps.append(("geometry_invalid", "Geometry lacks a positive residue count."))

    if (
        not isinstance(confidence_summary, dict)
        or confidence_summary.get("status") == "unavailable"
    ):
        gaps.append(("confidence_unavailable", "Per-residue confidence summary is unavailable."))
    elif not _is_finite(confidence_summary.get("mean_plddt")):
        gaps.append(("confidence_unavailable", "Confidence summary lacks valid mean pLDDT."))
    return gaps


def _confidence_rules(
    metrics: StructuralFeasibilityMetrics,
    reasons: list[StructuralFeasibilityReason],
    risks: list[StructuralFeasibilityRisk],
    rules: list[StructuralFeasibilityRule],
) -> int:
    delta = 0
    mean = metrics.mean_plddt
    if mean is not None and mean < 50:
        delta -= 35
        _risk(
            risks,
            "very_low_mean_plddt",
            StructuralFeasibilitySeverity.HIGH,
            "Mean pLDDT is very low.",
            mean,
            50,
        )
        _rule(
            rules,
            "confidence.mean_plddt.very_low",
            StructuralFeasibilityRuleOutcome.FAIL,
            mean,
            50,
            -35,
        )
    elif mean is not None and mean < 70:
        delta -= 18
        _risk(
            risks,
            "low_mean_plddt",
            StructuralFeasibilitySeverity.MODERATE,
            "Mean pLDDT is below the confident range.",
            mean,
            70,
        )
        _rule(
            rules,
            "confidence.mean_plddt.low",
            StructuralFeasibilityRuleOutcome.WARNING,
            mean,
            70,
            -18,
        )
    elif mean is not None and mean < 80:
        delta -= 6
        _risk(
            risks,
            "low_mean_plddt",
            StructuralFeasibilitySeverity.LOW,
            "Mean pLDDT is acceptable but below the high-confidence range.",
            mean,
            80,
        )
        _rule(
            rules,
            "confidence.mean_plddt.acceptable",
            StructuralFeasibilityRuleOutcome.WARNING,
            mean,
            80,
            -6,
        )
        _reason(
            reasons,
            "acceptable_mean_plddt",
            "Mean pLDDT is within the acceptable structural-confidence range.",
            mean,
            70,
        )
    else:
        _rule(
            rules,
            "confidence.mean_plddt.strong",
            StructuralFeasibilityRuleOutcome.PASS,
            mean,
            80,
            0,
        )
        _reason(
            reasons, "strong_mean_plddt", "Mean pLDDT is in the high-confidence range.", mean, 80
        )

    low_fraction = metrics.low_confidence_residue_fraction
    if low_fraction is not None and low_fraction > 0.50:
        delta -= 25
        _risk(
            risks,
            "low_confidence_residue_fraction",
            StructuralFeasibilitySeverity.HIGH,
            "More than half of residues are low confidence.",
            low_fraction,
            0.50,
        )
        _rule(
            rules,
            "confidence.low_fraction.major",
            StructuralFeasibilityRuleOutcome.FAIL,
            low_fraction,
            0.50,
            -25,
        )
    elif low_fraction is not None and low_fraction > 0.25:
        delta -= 15
        _risk(
            risks,
            "low_confidence_residue_fraction",
            StructuralFeasibilitySeverity.MODERATE,
            "A substantial fraction of residues are low confidence.",
            low_fraction,
            0.25,
        )
        _rule(
            rules,
            "confidence.low_fraction.moderate",
            StructuralFeasibilityRuleOutcome.WARNING,
            low_fraction,
            0.25,
            -15,
        )
    elif low_fraction is not None and low_fraction > 0.10:
        delta -= 5
        _risk(
            risks,
            "low_confidence_residue_fraction",
            StructuralFeasibilitySeverity.LOW,
            "A small fraction of residues are low confidence.",
            low_fraction,
            0.10,
        )
        _rule(
            rules,
            "confidence.low_fraction.minor",
            StructuralFeasibilityRuleOutcome.WARNING,
            low_fraction,
            0.10,
            -5,
        )
    else:
        _rule(
            rules,
            "confidence.low_fraction.acceptable",
            StructuralFeasibilityRuleOutcome.PASS,
            low_fraction,
            0.10,
            0,
        )

    confident = metrics.confident_residue_fraction
    if confident is not None and confident >= 0.75:
        _reason(
            reasons,
            "high_confident_residue_fraction",
            "Most residues are in the confident category.",
            confident,
            0.75,
        )

    minimum = metrics.minimum_plddt
    if minimum is not None and minimum < 30:
        delta -= 20
        _risk(
            risks,
            "very_low_minimum_plddt",
            StructuralFeasibilitySeverity.HIGH,
            "At least one residue has very low pLDDT.",
            minimum,
            30,
        )
        _rule(
            rules,
            "confidence.minimum.very_low",
            StructuralFeasibilityRuleOutcome.FAIL,
            minimum,
            30,
            -20,
        )
    elif minimum is not None and minimum < 50:
        delta -= 12
        _risk(
            risks,
            "very_low_minimum_plddt",
            StructuralFeasibilitySeverity.MODERATE,
            "Minimum residue pLDDT is below 50.",
            minimum,
            50,
        )
        _rule(
            rules,
            "confidence.minimum.low",
            StructuralFeasibilityRuleOutcome.WARNING,
            minimum,
            50,
            -12,
        )
    elif minimum is not None and minimum < 70:
        delta -= 5
        _risk(
            risks,
            "very_low_minimum_plddt",
            StructuralFeasibilitySeverity.LOW,
            "Minimum residue pLDDT is below the confident range.",
            minimum,
            70,
        )
        _rule(
            rules,
            "confidence.minimum.caution",
            StructuralFeasibilityRuleOutcome.WARNING,
            minimum,
            70,
            -5,
        )
    else:
        _rule(
            rules,
            "confidence.minimum.acceptable",
            StructuralFeasibilityRuleOutcome.PASS,
            minimum,
            70,
            0,
        )
    return delta


def _region_rules(
    metrics: StructuralFeasibilityMetrics,
    low_confidence_regions: list[dict[str, Any]],
    risks: list[StructuralFeasibilityRisk],
    rules: list[StructuralFeasibilityRule],
) -> int:
    delta = 0
    n = metrics.n_residues or 0
    long_threshold = max(
        LONG_LOW_CONFIDENCE_REGION_MIN_LENGTH,
        int(math.ceil(max(n, 1) * LONG_LOW_CONFIDENCE_REGION_FRACTION)),
    )
    longest = max((_int(region, "length") or 0 for region in low_confidence_regions), default=0)
    if longest >= long_threshold:
        region_delta = -18 if n and longest / n > 0.50 else -10
        severity = (
            StructuralFeasibilitySeverity.HIGH
            if region_delta == -18
            else StructuralFeasibilitySeverity.MODERATE
        )
        delta += region_delta
        _risk(
            risks,
            "long_low_confidence_region",
            severity,
            "A long contiguous low-confidence region is present.",
            longest,
            long_threshold,
        )
        _rule(
            rules,
            "confidence.low_region.long",
            StructuralFeasibilityRuleOutcome.WARNING,
            longest,
            long_threshold,
            region_delta,
        )
    else:
        _rule(
            rules,
            "confidence.low_region.long",
            StructuralFeasibilityRuleOutcome.PASS,
            longest,
            long_threshold,
            0,
        )

    count = metrics.low_confidence_region_count or 0
    if count > 1:
        region_delta = -min(10, (count - 1) * 5)
        delta += region_delta
        _risk(
            risks,
            "multiple_low_confidence_regions",
            StructuralFeasibilitySeverity.LOW,
            "Multiple low-confidence regions are present.",
            count,
            1,
        )
        _rule(
            rules,
            "confidence.low_region.multiple",
            StructuralFeasibilityRuleOutcome.WARNING,
            count,
            1,
            region_delta,
        )
    else:
        _rule(
            rules,
            "confidence.low_region.multiple",
            StructuralFeasibilityRuleOutcome.PASS,
            count,
            1,
            0,
        )
    return delta


def _geometry_rules(
    geometry: dict[str, Any] | None,
    metrics: StructuralFeasibilityMetrics,
    reasons: list[StructuralFeasibilityReason],
    risks: list[StructuralFeasibilityRisk],
    rules: list[StructuralFeasibilityRule],
) -> int:
    delta = 0
    invalid = False
    for field in (
        "radius_of_gyration_angstrom",
        "end_to_end_distance_angstrom",
        "compactness_ratio",
    ):
        value = geometry.get(field) if isinstance(geometry, dict) else None
        if isinstance(value, int | float) and not math.isfinite(float(value)):
            invalid = True
            _risk(
                risks,
                "geometry_invalid",
                StructuralFeasibilitySeverity.HIGH,
                f"Geometry field {field} is non-finite.",
                str(value),
            )

    n = metrics.n_residues or 0
    if metrics.radius_of_gyration_angstrom is not None and metrics.radius_of_gyration_angstrom < 0:
        invalid = True
        _risk(
            risks,
            "geometry_invalid",
            StructuralFeasibilitySeverity.HIGH,
            "Radius of gyration is negative.",
            metrics.radius_of_gyration_angstrom,
            0,
        )
    if (
        metrics.end_to_end_distance_angstrom is not None
        and metrics.end_to_end_distance_angstrom < 0
    ):
        invalid = True
        _risk(
            risks,
            "geometry_invalid",
            StructuralFeasibilitySeverity.HIGH,
            "End-to-end distance is negative.",
            metrics.end_to_end_distance_angstrom,
            0,
        )
    if (
        n > 1
        and metrics.radius_of_gyration_angstrom is not None
        and metrics.radius_of_gyration_angstrom <= 0
    ):
        delta -= 12
        _risk(
            risks,
            "geometry_invalid",
            StructuralFeasibilitySeverity.MODERATE,
            "Radius of gyration is non-positive for a multi-residue peptide.",
            metrics.radius_of_gyration_angstrom,
            0,
        )
    if (
        n > 1
        and metrics.end_to_end_distance_angstrom is not None
        and metrics.end_to_end_distance_angstrom <= 0
    ):
        delta -= 12
        _risk(
            risks,
            "geometry_invalid",
            StructuralFeasibilitySeverity.MODERATE,
            "End-to-end distance is non-positive for a multi-residue peptide.",
            metrics.end_to_end_distance_angstrom,
            0,
        )
    if invalid:
        delta -= 20
        _rule(
            rules,
            "geometry.numeric.valid",
            StructuralFeasibilityRuleOutcome.FAIL,
            None,
            "finite_non_negative",
            -20,
        )
    else:
        _rule(
            rules,
            "geometry.numeric.valid",
            StructuralFeasibilityRuleOutcome.PASS,
            None,
            "finite_non_negative",
            0,
        )
        _reason(
            reasons,
            "geometry_metrics_available",
            "Coordinate-derived geometry metrics are available.",
            True,
            True,
        )

    counts = [
        count
        for count in (
            metrics.structure_n_residues,
            metrics.geometry_n_residues,
            metrics.confidence_n_residues,
        )
        if count is not None
    ]
    if len(set(counts)) > 1:
        delta -= 15
        _risk(
            risks,
            "residue_count_mismatch",
            StructuralFeasibilitySeverity.HIGH,
            "Prediction, geometry, and confidence residue counts do not agree.",
            ",".join(map(str, counts)),
        )
        _rule(
            rules,
            "geometry.residue_count.match",
            StructuralFeasibilityRuleOutcome.FAIL,
            ",".join(map(str, counts)),
            "all_equal",
            -15,
        )
    else:
        _rule(
            rules,
            "geometry.residue_count.match",
            StructuralFeasibilityRuleOutcome.PASS,
            counts[0] if counts else None,
            "all_equal",
            0,
        )
        _reason(
            reasons,
            "no_major_residue_count_mismatch",
            "Prediction, geometry, and confidence residue counts agree.",
            counts[0] if counts else None,
            "all_equal",
        )

    compactness = metrics.compactness_ratio
    if compactness is not None:
        if compactness < COMPACTNESS_FAIL_RANGE[0] or compactness > COMPACTNESS_FAIL_RANGE[1]:
            delta -= 15
            _risk(
                risks,
                "suspicious_compactness",
                StructuralFeasibilitySeverity.HIGH,
                "Compactness ratio is outside the broad sanity range.",
                compactness,
                f"{COMPACTNESS_FAIL_RANGE[0]}-{COMPACTNESS_FAIL_RANGE[1]}",
            )
            _rule(
                rules,
                "geometry.compactness.broad_range",
                StructuralFeasibilityRuleOutcome.FAIL,
                compactness,
                f"{COMPACTNESS_FAIL_RANGE[0]}-{COMPACTNESS_FAIL_RANGE[1]}",
                -15,
            )
        elif (
            compactness < COMPACTNESS_CAUTION_RANGE[0] or compactness > COMPACTNESS_CAUTION_RANGE[1]
        ):
            delta -= 8
            _risk(
                risks,
                "suspicious_compactness",
                StructuralFeasibilitySeverity.MODERATE,
                "Compactness ratio is outside the conservative caution range.",
                compactness,
                f"{COMPACTNESS_CAUTION_RANGE[0]}-{COMPACTNESS_CAUTION_RANGE[1]}",
            )
            _rule(
                rules,
                "geometry.compactness.caution_range",
                StructuralFeasibilityRuleOutcome.WARNING,
                compactness,
                f"{COMPACTNESS_CAUTION_RANGE[0]}-{COMPACTNESS_CAUTION_RANGE[1]}",
                -8,
            )
        else:
            _rule(
                rules,
                "geometry.compactness.caution_range",
                StructuralFeasibilityRuleOutcome.PASS,
                compactness,
                f"{COMPACTNESS_CAUTION_RANGE[0]}-{COMPACTNESS_CAUTION_RANGE[1]}",
                0,
            )
    return delta


def _disulfide_rules(
    requested: list[tuple[int, int]],
    geometry: dict[str, Any] | None,
    reasons: list[StructuralFeasibilityReason],
    risks: list[StructuralFeasibilityRisk],
    rules: list[StructuralFeasibilityRule],
) -> int:
    if not requested:
        _rule(
            rules,
            "disulfide.requested",
            StructuralFeasibilityRuleOutcome.NOT_APPLICABLE,
            0,
            None,
            0,
        )
        return 0

    delta = 0
    by_pair = {
        tuple(item.get("pair", [])): item
        for item in (geometry or {}).get("disulfide_geometry", [])
        if isinstance(item, dict)
    }
    for pair in requested:
        item = by_pair.get(pair)
        if item is None:
            delta -= 12
            _risk(
                risks,
                "disulfide_geometry_unavailable",
                StructuralFeasibilitySeverity.MODERATE,
                "Requested disulfide bridge is missing from geometry output.",
                f"{pair[0]}-{pair[1]}",
            )
            _rule(
                rules,
                "disulfide.geometry.present",
                StructuralFeasibilityRuleOutcome.UNAVAILABLE,
                f"{pair[0]}-{pair[1]}",
                "geometry_record",
                -12,
            )
            continue
        distance = item.get("sg_sg_distance_angstrom")
        if item.get("geometry_consistent") is True:
            _reason(
                reasons,
                "requested_disulfides_are_plausible",
                "Requested disulfide bridge geometry is plausible.",
                distance,
                DISULFIDE_MAX_SG_DISTANCE_ANGSTROM,
            )
            _rule(
                rules,
                "disulfide.geometry.plausible",
                StructuralFeasibilityRuleOutcome.PASS,
                distance,
                DISULFIDE_MAX_SG_DISTANCE_ANGSTROM,
                0,
            )
        elif item.get("geometry_consistent") is False:
            delta -= 18
            _risk(
                risks,
                "disulfide_geometry_implausible",
                StructuralFeasibilitySeverity.HIGH,
                "Requested disulfide SG-SG distance exceeds the existing project threshold.",
                distance,
                DISULFIDE_MAX_SG_DISTANCE_ANGSTROM,
            )
            _rule(
                rules,
                "disulfide.geometry.plausible",
                StructuralFeasibilityRuleOutcome.FAIL,
                distance,
                DISULFIDE_MAX_SG_DISTANCE_ANGSTROM,
                -18,
            )
        else:
            delta -= 10
            _risk(
                risks,
                "disulfide_geometry_unavailable",
                StructuralFeasibilitySeverity.MODERATE,
                "Requested disulfide bridge could not be validated from SG atoms.",
                distance,
                DISULFIDE_MAX_SG_DISTANCE_ANGSTROM,
            )
            _rule(
                rules,
                "disulfide.geometry.plausible",
                StructuralFeasibilityRuleOutcome.UNAVAILABLE,
                distance,
                DISULFIDE_MAX_SG_DISTANCE_ANGSTROM,
                -10,
            )
    return delta


def _pdb_rule(
    include_pdb: bool,
    pdb_output: dict[str, Any] | None,
    risks: list[StructuralFeasibilityRisk],
    rules: list[StructuralFeasibilityRule],
) -> None:
    status = pdb_output.get("status") if isinstance(pdb_output, dict) else None
    if not include_pdb:
        _rule(
            rules,
            "pdb.output.requested",
            StructuralFeasibilityRuleOutcome.NOT_APPLICABLE,
            status,
            None,
            0,
        )
    elif status == "available":
        _rule(
            rules,
            "pdb.output.available",
            StructuralFeasibilityRuleOutcome.PASS,
            status,
            "available",
            0,
        )
    else:
        _risk(
            risks,
            "partial_structural_evidence",
            StructuralFeasibilitySeverity.LOW,
            "PDB output was requested but is unavailable.",
            status,
            "available",
        )
        _rule(
            rules,
            "pdb.output.available",
            StructuralFeasibilityRuleOutcome.UNAVAILABLE,
            status,
            "available",
            0,
        )


def _classification(
    score: int,
) -> tuple[
    StructuralFeasibilityStatus,
    StructuralFeasibilityDecision,
    StructuralFeasibilityRiskLevel,
]:
    if score >= 80:
        return (
            StructuralFeasibilityStatus.FEASIBLE,
            StructuralFeasibilityDecision.PROCEED,
            StructuralFeasibilityRiskLevel.LOW,
        )
    if score >= 60:
        return (
            StructuralFeasibilityStatus.FEASIBLE_WITH_CAUTION,
            StructuralFeasibilityDecision.PROCEED_WITH_CAUTION,
            StructuralFeasibilityRiskLevel.MODERATE,
        )
    return (
        StructuralFeasibilityStatus.NOT_FEASIBLE,
        StructuralFeasibilityDecision.DO_NOT_PROCEED,
        StructuralFeasibilityRiskLevel.HIGH,
    )


def _evidence_quality(
    score: int,
    metrics: StructuralFeasibilityMetrics,
    risks: list[StructuralFeasibilityRisk],
    include_pdb: bool,
    pdb_output: dict[str, Any] | None,
) -> StructuralFeasibilityEvidenceQuality:
    high_risk = any(risk.severity is StructuralFeasibilitySeverity.HIGH for risk in risks)
    requested_pdb_unavailable = include_pdb and (pdb_output or {}).get("status") != "available"
    if (
        score >= 80
        and (metrics.mean_plddt or 0) >= 80
        and not high_risk
        and not requested_pdb_unavailable
    ):
        return StructuralFeasibilityEvidenceQuality.HIGH
    if score >= 60:
        return StructuralFeasibilityEvidenceQuality.MODERATE
    return StructuralFeasibilityEvidenceQuality.LOW


def _recommendations_for_result(
    score: int,
    risks: list[StructuralFeasibilityRisk],
    recommendations: list[StructuralFeasibilityRecommendation],
) -> None:
    codes = {risk.code for risk in risks}
    if {
        "low_confidence_residue_fraction",
        "long_low_confidence_region",
        "multiple_low_confidence_regions",
        "very_low_minimum_plddt",
    } & codes:
        _recommend(recommendations, "review_low_confidence_region")
        _recommend(recommendations, "consider_alternative_conformations")
    if {"disulfide_geometry_unavailable", "disulfide_geometry_implausible"} & codes:
        _recommend(recommendations, "validate_disulfide_placement")
    if score < 60:
        _recommend(recommendations, "avoid_high_confidence_downstream_claims")
        _recommend(recommendations, "consider_experimental_confirmation")
    elif not codes:
        _recommend(recommendations, "proceed_to_downstream_analysis")


def _recommend(recommendations: list[StructuralFeasibilityRecommendation], code: str) -> None:
    messages = {
        "review_low_confidence_region": "Review low-confidence regions before high-confidence downstream interpretation.",
        "consider_alternative_conformations": "Consider ensemble or molecular-dynamics analysis for flexible peptide regions.",
        "validate_disulfide_placement": "Validate requested disulfide placement before relying on the isolated structure.",
        "avoid_high_confidence_downstream_claims": "Avoid high-confidence downstream structural claims from this isolated prediction.",
        "consider_experimental_confirmation": "Consider experimental confirmation before using this structure for critical decisions.",
        "proceed_to_downstream_analysis": "Proceed to downstream analysis using the isolated structure evidence.",
        "rerun_when_structural_evidence_available": "Rerun triage when prediction, confidence, and geometry evidence are available.",
    }
    if code not in {item.code for item in recommendations}:
        recommendations.append(
            StructuralFeasibilityRecommendation(code=code, message=messages[code])
        )


def _reason(
    reasons: list[StructuralFeasibilityReason],
    code: str,
    message: str,
    value: float | int | str | bool | None,
    threshold: float | int | str | bool | None,
) -> None:
    reasons.append(
        StructuralFeasibilityReason(code=code, message=message, value=value, threshold=threshold)
    )


def _risk(
    risks: list[StructuralFeasibilityRisk],
    code: str,
    severity: StructuralFeasibilitySeverity,
    message: str,
    value: float | int | str | bool | None = None,
    threshold: float | int | str | bool | None = None,
) -> None:
    risks.append(
        StructuralFeasibilityRisk(
            code=code,
            severity=severity,
            message=message,
            value=value,
            threshold=threshold,
        )
    )


def _rule(
    rules: list[StructuralFeasibilityRule],
    rule_id: str,
    outcome: StructuralFeasibilityRuleOutcome,
    value: float | int | str | bool | None = None,
    threshold: float | int | str | bool | None = None,
    score_delta: int = 0,
) -> None:
    rules.append(
        StructuralFeasibilityRule(
            rule_id=rule_id,
            outcome=outcome,
            value=value,
            threshold=threshold,
            score_delta=score_delta,
        )
    )


def _number(data: dict[str, Any] | None, key: str) -> float | None:
    if not isinstance(data, dict):
        return None
    value = data.get(key)
    return float(value) if _is_finite(value) else None


def _int(data: dict[str, Any] | None, key: str) -> int | None:
    if not isinstance(data, dict):
        return None
    value = data.get(key)
    return int(value) if isinstance(value, int) and value >= 0 else None


def _first_finite(*values: float | None) -> float | None:
    return next((value for value in values if value is not None and math.isfinite(value)), None)


def _is_finite(value: Any) -> bool:
    return isinstance(value, int | float) and math.isfinite(float(value))


def _positive_int(value: Any) -> bool:
    return isinstance(value, int) and value > 0
