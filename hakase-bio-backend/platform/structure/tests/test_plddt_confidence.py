from __future__ import annotations

import pytest
from hakase_structure.confidence import (
    build_confidence_report,
    detect_low_confidence_regions,
    plddt_confidence_category,
)


@pytest.mark.parametrize(
    ("plddt", "category"),
    [
        (90.0, "very_high"),
        (89.99, "confident"),
        (70.0, "confident"),
        (69.99, "low"),
        (50.0, "low"),
        (49.99, "very_low"),
    ],
)
def test_plddt_confidence_category_boundaries(plddt, category):
    assert plddt_confidence_category(plddt) == category


def test_per_residue_confidence_maps_input_order_and_one_based_positions():
    report = build_confidence_report("ACDEFG", [90.0, 89.99, 70.0, 69.99, 50.0, 49.99])

    assert report["warnings"] == []
    assert report["per_residue_confidence"] == [
        {
            "position": 1,
            "residue": "A",
            "plddt": 90.0,
            "confidence_category": "very_high",
        },
        {
            "position": 2,
            "residue": "C",
            "plddt": 89.99,
            "confidence_category": "confident",
        },
        {
            "position": 3,
            "residue": "D",
            "plddt": 70.0,
            "confidence_category": "confident",
        },
        {"position": 4, "residue": "E", "plddt": 69.99, "confidence_category": "low"},
        {"position": 5, "residue": "F", "plddt": 50.0, "confidence_category": "low"},
        {
            "position": 6,
            "residue": "G",
            "plddt": 49.99,
            "confidence_category": "very_low",
        },
    ]


def test_detects_one_low_confidence_region():
    assert detect_low_confidence_regions("ACDE", [80.0, 69.0, 60.0, 75.0]) == [
        {
            "start": 2,
            "end": 3,
            "length": 2,
            "mean_plddt": 64.5,
            "minimum_plddt": 60.0,
            "residues": "CD",
            "severity": "low",
        }
    ]


def test_detects_multiple_separate_low_confidence_regions():
    assert detect_low_confidence_regions("ACDEFG", [80.0, 69.0, 75.0, 49.0, 48.0, 90.0]) == [
        {
            "start": 2,
            "end": 2,
            "length": 1,
            "mean_plddt": 69.0,
            "minimum_plddt": 69.0,
            "residues": "C",
            "severity": "low",
        },
        {
            "start": 4,
            "end": 5,
            "length": 2,
            "mean_plddt": 48.5,
            "minimum_plddt": 48.0,
            "residues": "EF",
            "severity": "very_low",
        },
    ]


def test_detects_single_residue_region():
    assert detect_low_confidence_regions("ACD", [80.0, 45.0, 80.0]) == [
        {
            "start": 2,
            "end": 2,
            "length": 1,
            "mean_plddt": 45.0,
            "minimum_plddt": 45.0,
            "residues": "C",
            "severity": "very_low",
        }
    ]


def test_no_low_confidence_regions():
    assert detect_low_confidence_regions("ACD", [70.0, 80.0, 90.0]) == []


def test_confidence_summary_counts_and_fractions():
    report = build_confidence_report("ACDEFG", [90.0, 89.0, 70.0, 69.0, 50.0, 49.0])

    assert report["confidence_summary"] == {
        "total_residues": 6,
        "category_counts": {
            "very_high": 1,
            "confident": 2,
            "low": 2,
            "very_low": 1,
        },
        "category_fractions": {
            "very_high": 0.167,
            "confident": 0.333,
            "low": 0.333,
            "very_low": 0.167,
        },
        "low_confidence_residue_count": 3,
        "low_confidence_residue_fraction": 0.5,
        "low_confidence_region_count": 1,
        "mean_plddt": 69.5,
        "minimum_plddt": 49.0,
        "maximum_plddt": 90.0,
        "plddt_scale": "0-100",
    }


def test_sequence_length_plddt_length_mismatch_is_unavailable():
    report = build_confidence_report("ACDE", [80.0, 75.0])

    assert report["per_residue_confidence"] == []
    assert report["low_confidence_regions"] == []
    assert report["confidence_summary"]["status"] == "unavailable"
    assert report["confidence_summary"]["reason_code"] == "plddt_sequence_length_mismatch"
    assert report["confidence_summary"]["total_residues"] == 4
    assert report["confidence_summary"]["plddt_value_count"] == 2
    assert report["confidence_summary"]["plddt_scale"] == "0-100"
    assert "does not match" in report["warnings"][0]
