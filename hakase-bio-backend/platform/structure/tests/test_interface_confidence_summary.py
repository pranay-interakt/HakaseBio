from __future__ import annotations

from hakase_structure.structural_confidence import build_interface_confidence_summary


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


def test_phase1_provider_unavailable_returns_exact_unavailable_summary():
    result = build_interface_confidence_summary(
        complex_prediction=_complex("unavailable"),
        interface_analysis=None,
    )

    assert result == {
        "status": "unavailable",
        "overall_confidence": "unavailable",
        "overall_score": None,
        "analysis_scope": "peptide_target_interface",
        "interface_available": False,
        "reason_code": "interface_analysis_unavailable",
        "confidence_drivers": [],
        "warnings": [
            "Interface confidence cannot be calculated because no peptide-target complex is available."
        ],
        "provenance": {
            "calculator": "interface_confidence_aggregator",
            "calculator_version": "1.0.0",
            "ruleset_version": "1.0.0",
            "deterministic": True,
        },
    }


def test_phase1_completed_complex_without_interface_analysis_remains_unavailable():
    result = build_interface_confidence_summary(
        complex_prediction=_complex("completed"),
        interface_analysis=None,
    )

    assert result["status"] == "unavailable"
    assert result["overall_confidence"] == "unavailable"
    assert result["overall_score"] is None
    assert result["reason_code"] == "interface_analysis_unavailable"


def test_pending_complex_prediction_maps_to_pending_interface_summary():
    result = build_interface_confidence_summary(
        complex_prediction=_complex("pending"),
        interface_analysis=None,
    )

    assert result["status"] == "pending"
    assert result["overall_confidence"] == "unavailable"
    assert result["overall_score"] is None
    assert result["reason_code"] == "interface_analysis_pending"


def test_failed_interface_analysis_maps_to_failed_summary():
    result = build_interface_confidence_summary(
        complex_prediction=_complex("completed"),
        interface_analysis={"status": "failed", "reason_code": "interface_analysis_failed"},
    )

    assert result["status"] == "failed"
    assert result["overall_confidence"] == "unavailable"
    assert result["overall_score"] is None
    assert result["reason_code"] == "interface_analysis_failed"


def test_interface_analysis_without_confidence_values_is_not_available():
    result = build_interface_confidence_summary(
        complex_prediction=_complex("completed"),
        interface_analysis={"status": "available", "present": True},
    )

    assert result["status"] == "unavailable"
    assert result["overall_confidence"] == "unavailable"
    assert result["overall_score"] is None
    assert result["reason_code"] == "interface_analysis_unavailable"


def test_available_interface_summary_uses_only_supplied_confidence_values():
    result = build_interface_confidence_summary(
        complex_prediction=_complex("completed"),
        interface_analysis={
            "status": "available",
            "overall_confidence": "high",
            "overall_score": 84,
            "binding_interface_confidence": {
                "status": "available",
                "confidence": "high",
                "score": 84,
            },
            "confidence_drivers": ["Interface analysis supplied binding confidence."],
        },
    )

    assert result["status"] == "available"
    assert result["overall_confidence"] == "high"
    assert result["overall_score"] == 84
    assert result["binding_interface_confidence"]["score"] == 84
    assert result["buried_surface_confidence"]["status"] == "unavailable"
