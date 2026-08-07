from __future__ import annotations

import math

from hakase_structure.structural_confidence import build_structural_confidence_summary


def _isolated(mean: float = 74.0, n: int = 9, status: str = "available"):
    if status != "available":
        return {
            "status": status,
            "reason_code": "structure_prediction_failed",
            "prediction": None,
        }
    return {
        "status": "available",
        "prediction": {
            "provider": "fake_esmfold",
            "model_id": "esmfold_v1",
            "model_version": "test",
            "n_residues": n,
            "mean_plddt": mean,
        },
    }


def _geometry(mean: float = 74.0, n: int = 9, confident_fraction: float = 0.75):
    return {
        "n_residues": n,
        "mean_plddt": mean,
        "min_plddt": mean - 10,
        "max_plddt": mean + 10,
        "confident_residue_fraction": confident_fraction,
        "radius_of_gyration_angstrom": 4.0,
        "end_to_end_distance_angstrom": 6.0,
        "compactness_ratio": 1.1,
    }


def _confidence(mean: float = 74.0, n: int = 9):
    return {
        "total_residues": n,
        "mean_plddt": mean,
        "minimum_plddt": mean - 10,
        "maximum_plddt": mean + 10,
        "low_confidence_residue_fraction": 0.2,
        "low_confidence_region_count": 1,
    }


def _feasibility(score: int = 74, status: str = "feasible_with_caution"):
    return {
        "status": status,
        "decision": "proceed_with_caution",
        "score": score,
        "risk_level": "moderate",
        "evidence_quality": "moderate",
    }


def _target(status: str = "resolved"):
    if status == "not_provided":
        return {
            "status": "not_provided",
            "resolution_level": "none",
            "confidence": "not_applicable",
        }
    return {
        "status": status,
        "resolution_level": "sequence_only",
        "confidence": "high",
        "resolved_target": {"sequence": "MRPSGTAGAALLALLAALCPASRA"},
    }


def _complex(status: str = "unavailable"):
    return {
        "status": status,
        "provider": "boltz2",
        "model_version": "1.0",
        "complex_available": status == "completed",
        "confidence": "high" if status == "completed" else None,
        "warnings": [{"code": "provider_unavailable", "message": "provider offline"}],
        "errors": [],
    }


def _summary(**overrides):
    values = {
        "isolated_structure": _isolated(),
        "geometry": _geometry(),
        "confidence_summary": _confidence(),
        "structural_feasibility": _feasibility(),
        "target_resolution": _target(),
        "complex_prediction": _complex(),
        "interface_analysis": None,
    }
    values.update(overrides)
    return build_structural_confidence_summary(**values)


def test_successful_isolated_peptide_structure_with_moderate_plddt():
    result = _summary()

    assert result["status"] == "available"
    assert result["overall_confidence"] == "moderate"
    assert result["isolated_structure_confidence"]["confidence"] == "moderate"
    assert result["complex_confidence"]["status"] == "unavailable"
    assert result["interface_confidence"]["status"] == "unavailable"
    assert result["provenance"]["calculator"] == "structural_confidence_aggregator"


def test_high_confidence_isolated_peptide_is_available():
    result = _summary(
        isolated_structure=_isolated(mean=88.0, n=53),
        geometry=_geometry(mean=88.0, n=53, confident_fraction=1.0),
        confidence_summary=_confidence(mean=88.0, n=53),
        structural_feasibility=_feasibility(score=96, status="feasible"),
    )

    assert result["overall_confidence"] == "high"
    assert result["evidence_quality"] == "high"


def test_short_isolated_peptide_caps_confidence_and_quality_without_changing_score():
    result = _summary(
        isolated_structure=_isolated(mean=80.0, n=16),
        geometry=_geometry(mean=80.0, n=16, confident_fraction=0.6),
        confidence_summary=_confidence(mean=80.0, n=16),
        structural_feasibility=_feasibility(score=80, status="feasible"),
        complex_prediction=_complex("unavailable"),
        interface_analysis=None,
    )

    assert result["overall_score"] == 80
    assert result["overall_confidence"] == "moderate"
    assert result["evidence_quality"] == "moderate"


def test_short_peptide_cap_does_not_apply_when_complex_prediction_is_available():
    result = _summary(
        isolated_structure=_isolated(mean=88.0, n=16),
        geometry=_geometry(mean=88.0, n=16, confident_fraction=1.0),
        confidence_summary=_confidence(mean=88.0, n=16),
        structural_feasibility=_feasibility(score=96, status="feasible"),
        complex_prediction=_complex("completed"),
    )

    assert result["complex_confidence"]["status"] == "available"
    assert result["overall_confidence"] in {"high", "very_high"}
    assert result["evidence_quality"] == "high"


def test_low_confidence_isolated_peptide_remains_available_but_low():
    result = _summary(
        isolated_structure=_isolated(mean=45.0),
        geometry=_geometry(mean=45.0, confident_fraction=0.0),
        confidence_summary=_confidence(mean=45.0),
        structural_feasibility=_feasibility(score=35, status="not_feasible"),
    )

    assert result["status"] == "available"
    assert result["overall_confidence"] == "very_low"
    assert result["feasibility_confidence"]["feasibility_status"] == "not_feasible"


def test_provider_unavailable_does_not_fail_isolated_summary():
    result = _summary(complex_prediction=_complex(status="unavailable"))

    assert result["status"] == "available"
    assert result["complex_confidence"]["status"] == "unavailable"
    assert "provider_unavailable" == result["complex_confidence"]["reason_code"]


def test_no_target_supplied_marks_target_complex_and_interface_not_applicable():
    result = _summary(target_resolution=_target("not_provided"), complex_prediction=_complex())

    assert result["analysis_scope"] == "isolated_peptide"
    assert result["target_confidence"]["status"] == "not_applicable"
    assert result["complex_confidence"]["status"] == "not_applicable"
    assert result["interface_confidence"]["status"] == "not_applicable"


def test_target_resolved_but_complex_unavailable_uses_target_context_scope():
    result = _summary(target_resolution=_target(), complex_prediction=_complex("unavailable"))

    assert result["target_confidence"]["status"] == "available"
    assert result["complex_confidence"]["status"] == "unavailable"
    assert result["analysis_scope"] == "isolated_peptide_with_target_context"


def test_residue_count_mismatch_reduces_geometry_and_overall_confidence():
    result = _summary(geometry=_geometry(n=8), confidence_summary=_confidence(n=9))

    assert result["geometry_confidence"]["confidence"] == "low"
    assert result["overall_confidence"] == "low"
    assert any("Residue counts differ" in warning for warning in result["warnings"])


def test_missing_geometry_keeps_isolated_summary_available_with_warning():
    result = _summary(geometry=None, structural_feasibility=_feasibility(score=72))

    assert result["status"] == "available"
    assert result["geometry_confidence"]["status"] == "unavailable"
    assert result["evidence_quality"] in {"low", "moderate"}


def test_feasibility_reject_caps_confidence():
    result = _summary(structural_feasibility=_feasibility(score=20, status="not_feasible"))

    assert result["overall_confidence"] in {"very_low", "low"}
    assert result["overall_score"] <= 45
    assert any("rejects" in warning for warning in result["warnings"])


def test_upstream_prediction_failure_returns_failed_without_score():
    result = _summary(
        isolated_structure=_isolated(status="unavailable"),
        geometry=None,
        confidence_summary=None,
        structural_feasibility=_feasibility(score=0, status="insufficient_evidence"),
    )

    assert result["status"] == "failed"
    assert result["overall_score"] is None
    assert result["overall_confidence"] == "unavailable"


def test_no_fabricated_complex_or_interface_confidence():
    result = _summary(complex_prediction=_complex("pending"), interface_analysis=None)

    assert result["complex_confidence"]["status"] == "pending"
    assert result["complex_confidence"]["score"] is None
    assert result["complex_confidence"]["confidence"] == "unavailable"
    assert result["interface_confidence"]["status"] == "unavailable"
    assert result["interface_confidence"]["score"] is None
    assert result["interface_confidence"]["confidence"] == "unavailable"


def test_invalid_geometry_values_reduce_confidence():
    geometry = _geometry()
    geometry["radius_of_gyration_angstrom"] = math.inf

    result = _summary(geometry=geometry)

    assert result["geometry_confidence"]["confidence"] in {"low", "very_low"}
    assert any("invalid numeric" in warning for warning in result["warnings"])
