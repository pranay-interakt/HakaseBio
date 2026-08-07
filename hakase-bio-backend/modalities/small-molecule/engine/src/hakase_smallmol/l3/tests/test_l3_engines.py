"""Unit tests for the L3 engines (deterministic; no network, no ML).

These exercise the pure orchestration/analysis logic with synthetic inputs. A
separate integration test (``test_l3_pipeline_integration.py``) runs the real
IVIVE→cohort pipeline and is skipped when the ADMET ML stack is unavailable.

Run:
    pytest modalities/small-molecule/engine/src/hakase_smallmol/l3/tests -q
"""

from __future__ import annotations

import pytest

from hakase_smallmol.l3.pbpk_adapter import AnimalSpec, parse_frequency_h
from hakase_smallmol.l3.study_engine import StudyDesignError, build_arms, normalize_dose_groups


# ── study_engine ──────────────────────────────────────────────────────────────
def test_parse_frequency_tokens():
    assert parse_frequency_h(None) is None
    assert parse_frequency_h("SINGLE") is None
    assert parse_frequency_h("QD") == 24.0
    assert parse_frequency_h("BID") == 12.0
    assert parse_frequency_h("Q8H") == 8.0
    with pytest.raises(ValueError):
        parse_frequency_h("WEEKLY")


def test_normalize_dose_groups_labels_and_order():
    groups = normalize_dose_groups(
        [{"dose_mg_per_kg": 100}, {"dose_mg_per_kg": 5}, {"dose_mg_per_kg": 25}]
    )
    active = [g for g in groups if not g["is_control"]]
    assert [g["label"] for g in active] == ["Low", "Mid", "High"]
    assert [g["dose_mg_per_kg"] for g in active] == [5.0, 25.0, 100.0]


def test_normalize_dose_groups_requires_active():
    with pytest.raises(StudyDesignError):
        normalize_dose_groups([{"dose_mg_per_kg": 0}])


def test_build_arms_control_not_simulated():
    arms, _ = build_arms(
        animal=AnimalSpec(species="rat", strain="sprague_dawley"),
        dose_groups=[{"dose_mg_per_kg": 0, "is_control": True}, {"dose_mg_per_kg": 10}],
        route="ORAL",
        frequency="QD",
        duration_h=24.0,
    )
    assert len(arms) == 1  # control not simulated
    assert arms[0].dose_mg_per_kg == 10.0
    assert arms[0].frequency == "QD"


def test_build_arms_rejects_bad_route_and_species():
    with pytest.raises(StudyDesignError):
        build_arms(
            animal=AnimalSpec(species="rat"),
            dose_groups=[{"dose_mg_per_kg": 10}],
            route="INTRATHECAL",
            frequency=None,
            duration_h=24.0,
        )
    with pytest.raises(StudyDesignError):
        build_arms(
            animal=AnimalSpec(species="unicorn"),
            dose_groups=[{"dose_mg_per_kg": 10}],
            route="IV",
            frequency=None,
            duration_h=24.0,
        )


# ── pkpd_engine ───────────────────────────────────────────────────────────────
def _synthetic_arm(
    dose: float, auc_median: float, cmax: float = 1.0, mw: float = 200.0, fu: float = 0.2
):
    """A minimal arm_result carrying just what the pkpd/coverage math reads."""
    times = [0.0, 1.0, 2.0, 4.0, 8.0]
    conc = [0.0, cmax, cmax * 0.6, cmax * 0.3, cmax * 0.1]  # mg/L
    return {
        "available": True,
        "arm": {"label": "X", "dose_mg_per_kg": dose},
        "ivive": {"mw_g_per_mol": mw, "inputs": {"fu_plasma": {"value": fu}}},
        "cohort": {
            "time": times,
            "curves": {"plasma": {"mean": conc}},
            "endpoints": {"plasma": {"auc": {"median": auc_median}, "c_max": {"median": cmax}}},
        },
    }


def test_dose_proportionality_linear():
    from hakase_smallmol.l3.pkpd_engine import dose_proportionality

    # AUC exactly proportional to dose → beta ≈ 1.
    arms = [_synthetic_arm(5, 5.0), _synthetic_arm(25, 25.0), _synthetic_arm(100, 100.0)]
    res = dose_proportionality(arms)
    assert res["available"]
    assert abs(res["beta_slope"] - 1.0) < 1e-6
    assert "linear" in res["classification"]


def test_dose_proportionality_needs_two_arms():
    from hakase_smallmol.l3.pkpd_engine import dose_proportionality

    assert dose_proportionality([_synthetic_arm(5, 5.0)])["available"] is False


def test_target_coverage_absent_potency():
    from hakase_smallmol.l3.pkpd_engine import target_coverage

    assert target_coverage(_synthetic_arm(10, 10.0), None)["available"] is False


def test_target_coverage_occupancy_bounds():
    from hakase_smallmol.l3.pkpd_engine import target_coverage

    # Very potent (low Kd) → high occupancy; very weak (high Kd) → low occupancy.
    arm = _synthetic_arm(10, 10.0, cmax=10.0, mw=200.0, fu=0.5)
    potent = target_coverage(arm, {"value_nM": 1.0, "provenance": "ml", "source": "t"})
    weak = target_coverage(arm, {"value_nM": 1e9, "provenance": "ml", "source": "t"})
    assert potent["available"] and weak["available"]
    assert 0.0 <= weak["peak_occupancy"] < potent["peak_occupancy"] <= 1.0


# ── safety_engine ─────────────────────────────────────────────────────────────
def test_allometric_anchor_scales_rat_to_dog():
    from hakase_smallmol.l3.safety_engine import KM_FACTORS, allometric_anchor

    evidence = {
        "noael_anchor": {"noael_mg_kg_day": 60.0, "species_covered": ["rat"], "source": "CCTE"}
    }
    res = allometric_anchor(evidence, "dog")
    assert res["available"]
    # dog NOAEL = 60 * km_rat/km_dog = 60 * 6/20 = 18 mg/kg
    expected = 60.0 * KM_FACTORS["rat"] / KM_FACTORS["dog"]
    assert abs(res["estimated_noael_mg_kg_study_species"] - expected) < 1e-6
    assert res["interval_mg_kg"][0] < expected < res["interval_mg_kg"][1]


def test_allometric_anchor_no_evidence():
    from hakase_smallmol.l3.safety_engine import allometric_anchor

    assert allometric_anchor({}, "rat")["available"] is False


def test_compute_safety_dose_margins():
    from hakase_smallmol.l3.safety_engine import compute_safety

    evidence = {
        "noael_anchor": {"noael_mg_kg_day": 60.0, "species_covered": ["rat"], "source": "CCTE"}
    }
    arms = [_synthetic_arm(6.0, 6.0)]
    arms[0]["arm"] = {"label": "High", "dose_mg_per_kg": 6.0}
    safety = compute_safety(
        resolved_safety_flags={"herg": {"signal": "low", "probability": 0.1}},
        arm_results=arms,
        evidence=evidence,
        study_species="rat",
    )
    margins = safety["per_arm_margins"]
    assert margins and margins[0]["margin_to_allometric_noael"] is not None
    assert safety["anchors"]["evidence_noael"]["value_mg_kg_day"] == 60.0
    assert safety["anchors"]["in_vitro_pod"]["available"] is False  # honest not-integrated


# ── decision_engine ───────────────────────────────────────────────────────────
def test_stage_gate_no_exposure_is_nogo():
    from hakase_smallmol.l3.decision_engine import stage_gate

    gate = stage_gate(
        arm_results=[{"available": False, "reason": "out of domain"}],
        pkpd={"per_arm": []},
        safety={"per_arm_margins": [], "hazard_flags": []},
        evidence={"sources_with_data": []},
        sensitivity={"available": False},
    )
    assert gate["recommendation"] == "NO-GO"
    assert gate["criteria"]["domain"]["status"] == "fail"


def test_stage_gate_conditional_on_unknowns():
    from hakase_smallmol.l3.decision_engine import stage_gate

    gate = stage_gate(
        arm_results=[{"available": True, "confidence": {"level": "nominal"}}],
        pkpd={"per_arm": [{"arm": {"label": "X"}, "target_coverage": {"available": False}}]},
        safety={"per_arm_margins": [], "hazard_flags": []},
        evidence={"sources_with_data": []},
        sensitivity={"available": True, "dominant_driver": "fu_plasma"},
    )
    assert gate["recommendation"] == "CONDITIONAL"
    assert gate["value_of_information"]  # non-empty guidance
