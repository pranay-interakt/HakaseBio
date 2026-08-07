from __future__ import annotations

import math

from hakase_peptide.domain.schemas.structural import StructuralFeasibilityResult
from hakase_peptide.structure.structural_feasibility import build_structural_feasibility


def _structure(mean=90.0, n=9):
    return {
        "provider": "fake",
        "model_id": "esmfold_v1",
        "model_version": "test",
        "n_residues": n,
        "mean_plddt": mean,
        "plddt_scale": "0-100",
        "raw_plddt_scale": "0-100",
    }


def _geometry(mean=90.0, n=9, min_plddt=82.0, max_plddt=95.0, **overrides):
    data = {
        "n_residues": n,
        "mean_plddt": mean,
        "min_plddt": min_plddt,
        "max_plddt": max_plddt,
        "plddt_scale": "0-100",
        "confident_residue_fraction": 1.0,
        "radius_of_gyration_angstrom": 4.0,
        "end_to_end_distance_angstrom": 6.0,
        "compactness_ratio": 1.1,
        "disulfide_geometry": [],
    }
    data.update(overrides)
    return data


def _confidence(mean=90.0, n=9, min_plddt=82.0, max_plddt=95.0, low_fraction=0.0, regions=0):
    return {
        "total_residues": n,
        "low_confidence_residue_fraction": low_fraction,
        "low_confidence_region_count": regions,
        "mean_plddt": mean,
        "minimum_plddt": min_plddt,
        "maximum_plddt": max_plddt,
        "plddt_scale": "0-100",
    }


def _triage(**overrides):
    values = {
        "structure": _structure(),
        "geometry": _geometry(),
        "confidence_summary": _confidence(),
        "low_confidence_regions": [],
        "requested_disulfides": [],
        "pdb_output": {"status": "not_requested", "format": "pdb", "content": None},
        "include_pdb": False,
        "isolated_structure_status": "available",
    }
    values.update(overrides)
    return build_structural_feasibility(**values)


def _codes(items):
    return {item["code"] for item in items}


def _rule(result, rule_id):
    return next(item for item in result["rules_triggered"] if item["rule_id"] == rule_id)


def test_high_confidence_feasible_case_and_schema_serialization():
    result = _triage()

    assert result["status"] == "feasible"
    assert result["decision"] == "proceed"
    assert result["score"] == 100
    assert result["risk_level"] == "low"
    assert result["evidence_quality"] == "high"
    assert "strong_mean_plddt" in _codes(result["reasons"])
    assert result["recommendations"] == [
        {
            "code": "proceed_to_downstream_analysis",
            "message": "Proceed to downstream analysis using the isolated structure evidence.",
        }
    ]
    assert StructuralFeasibilityResult.model_validate(result).model_dump(mode="json") == result


def test_moderate_confidence_caution_case():
    result = _triage(
        structure=_structure(mean=74.0),
        geometry=_geometry(mean=74.0, min_plddt=49.0, confident_residue_fraction=0.667),
        confidence_summary=_confidence(
            mean=74.0,
            min_plddt=49.0,
            low_fraction=0.333,
            regions=2,
        ),
        low_confidence_regions=[
            {"start": 2, "end": 3, "length": 2},
            {"start": 7, "end": 7, "length": 1},
        ],
    )

    assert result["status"] == "feasible_with_caution"
    assert result["decision"] == "proceed_with_caution"
    assert result["risk_level"] == "moderate"
    assert result["score"] == 62
    assert {"low_confidence_residue_fraction", "multiple_low_confidence_regions"} <= _codes(
        result["risks"]
    )


def test_low_confidence_not_feasible_case_and_score_clamp():
    result = _triage(
        structure=_structure(mean=20.0),
        geometry=_geometry(
            mean=20.0,
            min_plddt=5.0,
            max_plddt=35.0,
            confident_residue_fraction=0.0,
            compactness_ratio=20.0,
            radius_of_gyration_angstrom=0.0,
            end_to_end_distance_angstrom=0.0,
            disulfide_geometry=[
                {"pair": [1, 2], "sg_sg_distance_angstrom": 9.0, "geometry_consistent": False},
                {"pair": [3, 4], "sg_sg_distance_angstrom": None, "geometry_consistent": None},
            ],
        ),
        confidence_summary=_confidence(
            mean=20.0,
            min_plddt=5.0,
            max_plddt=35.0,
            low_fraction=1.0,
            regions=4,
        ),
        low_confidence_regions=[{"start": 1, "end": 9, "length": 9}],
        requested_disulfides=[(1, 2), (3, 4), (5, 6)],
    )

    assert result["status"] == "not_feasible"
    assert result["decision"] == "do_not_proceed"
    assert result["risk_level"] == "high"
    assert result["score"] == 0
    assert {"very_low_mean_plddt", "disulfide_geometry_implausible"} <= _codes(result["risks"])


def test_missing_prediction_geometry_and_confidence_are_insufficient_evidence():
    missing_prediction = _triage(structure={"status": "unavailable"})
    missing_geometry = _triage(geometry={"status": "unavailable"})
    missing_confidence = _triage(confidence_summary={"status": "unavailable"})

    for result in (missing_prediction, missing_geometry, missing_confidence):
        assert result["status"] == "insufficient_evidence"
        assert result["decision"] == "review_required"
        assert result["score"] is None
        assert result["risk_level"] == "unknown"
        assert result["evidence_quality"] == "insufficient"

    assert "prediction_unavailable" in _codes(missing_prediction["risks"])
    assert "geometry_missing" in _codes(missing_geometry["risks"])
    assert "confidence_unavailable" in _codes(missing_confidence["risks"])


def test_residue_count_mismatch_and_invalid_geometry_values_are_reported():
    mismatch = _triage(
        geometry=_geometry(n=8),
        confidence_summary=_confidence(n=9),
    )
    invalid = _triage(
        geometry=_geometry(radius_of_gyration_angstrom=math.inf),
    )

    assert "residue_count_mismatch" in _codes(mismatch["risks"])
    assert _rule(mismatch, "geometry.residue_count.match")["outcome"] == "fail"
    assert "geometry_invalid" in _codes(invalid["risks"])
    assert _rule(invalid, "geometry.numeric.valid")["outcome"] == "fail"
    assert invalid["metrics"]["radius_of_gyration_angstrom"] is None


def test_long_and_multiple_low_confidence_regions_trigger_distinct_rules():
    result = _triage(
        confidence_summary=_confidence(mean=76.0, min_plddt=60.0, low_fraction=0.45, regions=3),
        low_confidence_regions=[
            {"start": 1, "end": 4, "length": 4},
            {"start": 6, "end": 6, "length": 1},
            {"start": 8, "end": 8, "length": 1},
        ],
    )

    assert {"long_low_confidence_region", "multiple_low_confidence_regions"} <= _codes(
        result["risks"]
    )
    assert _rule(result, "confidence.low_region.long")["score_delta"] == -10
    assert _rule(result, "confidence.low_region.multiple")["score_delta"] == -10


def test_disulfide_not_requested_plausible_and_implausible_cases():
    none_requested = _triage()
    plausible = _triage(
        geometry=_geometry(
            disulfide_geometry=[
                {"pair": [1, 6], "sg_sg_distance_angstrom": 2.05, "geometry_consistent": True}
            ]
        ),
        requested_disulfides=[(1, 6)],
    )
    implausible = _triage(
        geometry=_geometry(
            disulfide_geometry=[
                {"pair": [1, 6], "sg_sg_distance_angstrom": 3.1, "geometry_consistent": False}
            ]
        ),
        requested_disulfides=[(1, 6)],
    )

    assert _rule(none_requested, "disulfide.requested")["outcome"] == "not_applicable"
    assert "requested_disulfides_are_plausible" in _codes(plausible["reasons"])
    assert "disulfide_geometry_implausible" in _codes(implausible["risks"])


def test_include_pdb_false_has_no_penalty_and_requested_unavailable_does_not_fail():
    not_requested = _triage(include_pdb=False)
    unavailable = _triage(
        include_pdb=True,
        pdb_output={"status": "unavailable", "format": "pdb", "content": None},
    )

    assert not_requested["score"] == 100
    assert _rule(not_requested, "pdb.output.requested")["outcome"] == "not_applicable"
    assert unavailable["score"] == 100
    assert unavailable["status"] == "feasible"
    assert "partial_structural_evidence" in _codes(unavailable["risks"])
    assert unavailable["evidence_quality"] == "moderate"
