"""Unit tests for the Confirmation stages 6-9 engines.

These cover the properties that must not silently change:

* the occupancy relationship is the textbook one (Cu = Kd at 50%, 4*Kd at 80%,
  9*Kd at 90%);
* an apparent potency (IC50/EC50) is never presented as an equilibrium Kd;
* a probability is never converted into a concentration and therefore never
  becomes a margin;
* a margin below the critical fold-ratio blocks confirmation;
* a missing Layer-1 review blocks confirmation.

The three modules under test are deliberately dependency-free (no RDKit, no
model weights), so these run in milliseconds and in any environment.
"""

from __future__ import annotations

import pytest

from hakase_smallmol.l2.confirmation_block import build_confirmation_block
from hakase_smallmol.l2.pd_coupling import (
    concentration_for_occupancy,
    occupancy_at,
    predict_pd_coupling,
)
from hakase_smallmol.l2.therapeutic_index import (
    extract_concentration_nm,
    rank_therapeutic_index,
)

L1 = {
    "target_evidence": {"activity_type": "Ki", "value_nM": 5.0},
    "admet_endpoints": {"PPBR_AZ": {"model_value": 95.0}},
    "descriptors": {"molecular_weight_da": 300.0},
    "verdict": {"verdict": "GO"},
    "review": None,
}
IVIVE = {"exposure": {"c0_mg_per_l": 1.5, "dose_mg": 100, "route": "iv"}}

SAFETY = {
    "cardiotox": {"prediction": {"blocker_probability": 0.71, "risk_class": "High"}},
    "dili_ml": {"prediction": {"dili_probability": 0.2}},
    "ames_ml": {"prediction": {"mutagenic_probability": 0.1}},
    "tox21": {"summary": {"n_assays_evaluated": 12, "n_flagged_in_domain": 2}},
}


# ── Stage 7: occupancy ───────────────────────────────────────────────────────


def test_occupancy_is_one_half_at_kd():
    assert occupancy_at(10.0, 10.0) == pytest.approx(0.5)


@pytest.mark.parametrize(
    ("fraction", "multiple_of_kd"),
    [(0.5, 1.0), (0.8, 4.0), (0.9, 9.0), (0.99, 99.0)],
)
def test_concentration_for_occupancy_matches_clark(fraction, multiple_of_kd):
    assert concentration_for_occupancy(fraction, 10.0) == pytest.approx(10.0 * multiple_of_kd)


def test_measured_ki_is_used_directly():
    result = predict_pd_coupling(l1=L1)
    assert result["available"] is True
    assert result["affinity_anchor"]["provenance"] == "measured"
    assert result["affinity_anchor"]["affinity_is_apparent"] is False


def test_ic50_anchor_is_flagged_as_apparent():
    l1 = {**L1, "target_evidence": {"activity_type": "IC50", "value_nM": 5.0}}
    result = predict_pd_coupling(l1=l1)
    assert result["affinity_anchor"]["affinity_is_apparent"] is True
    assert "Cheng-Prusoff" in result["limitations"][0]


def test_binding_ml_is_the_fallback_anchor_not_the_first_choice():
    result = predict_pd_coupling(
        l1={**L1, "target_evidence": None}, binding_ml={"prediction": {"Kd_nM": 20.0}}
    )
    assert result["affinity_anchor"]["provenance"] == "ml"
    assert result["affinity_anchor"]["kd_nm"] == 20.0


def test_out_of_domain_affinity_is_carried_into_the_anchor():
    result = predict_pd_coupling(
        l1={**L1, "target_evidence": None},
        binding_ml={
            "prediction": {"Kd_nM": 20.0},
            "applicability_domain": {
                "verdict": "out_of_domain",
                "rationale": "This UniProt does not appear in the training set.",
            },
        },
    )
    assert result["affinity_anchor"]["applicability_domain"] == "out_of_domain"
    assert "extrapolation" in result["limitations"][0]


def test_out_of_domain_affinity_blocks_confirmation():
    engagement = predict_pd_coupling(
        l1={**L1, "target_evidence": None},
        binding_ml={
            "prediction": {"Kd_nM": 20.0},
            "applicability_domain": {"verdict": "out_of_domain", "rationale": "Novel target."},
        },
    )
    block = build_confirmation_block(l1=L1, stage_results={"7": engagement})
    assert any(item["code"] == "ENGAGEMENT_OUT_OF_DOMAIN" for item in block["conditions"])
    assert block["verdict"] == "NOT-CONFIRMED"


def test_no_affinity_refuses_rather_than_guessing():
    result = predict_pd_coupling(l1={"admet_endpoints": {}})
    assert result["available"] is False
    assert result["source"] == "insufficient-input"
    assert result["missing"]


def test_achieved_occupancy_uses_unbound_concentration():
    result = predict_pd_coupling(l1=L1, ivive=IVIVE)
    achieved = result["achieved_engagement"]
    # 1.5 mg/L / 300 g/mol * 1e6 = 5000 nM total; fu = 0.05 -> 250 nM unbound.
    assert achieved["total_concentration_nm"] == pytest.approx(5000.0)
    assert achieved["unbound_concentration_nm"] == pytest.approx(250.0)
    assert achieved["cu_over_kd"] == pytest.approx(50.0)
    assert achieved["occupancy_percent"] == pytest.approx(250 / 255 * 100, abs=0.01)


def test_no_dose_still_returns_the_dose_independent_requirement():
    result = predict_pd_coupling(l1=L1)
    assert result["achieved_engagement"]["available"] is False
    assert len(result["required_unbound_concentrations"]) == 3


# ── Stage 8: therapeutic index ───────────────────────────────────────────────


def test_a_probability_is_never_read_as_a_concentration():
    assert extract_concentration_nm({"prediction": {"blocker_probability": 0.9}}) is None


def test_micromolar_is_converted_to_nanomolar():
    found = extract_concentration_nm({"prediction": {"ic50_uM": 2.0}})
    assert found["value_nm"] == pytest.approx(2000.0)


def test_probability_only_safety_yields_no_margins_but_names_the_measurement():
    engagement = predict_pd_coupling(l1=L1, ivive=IVIVE)
    result = rank_therapeutic_index(pd_coupling=engagement, safety_stage=SAFETY)
    assert result["computed_margins"] == []
    assert len(result["not_computable"]) == 4
    assert any("hERG IC50" in item["required_measurement"] for item in result["not_computable"])
    assert result["categorical_liabilities"]


def test_measured_herg_ic50_produces_a_ranked_margin():
    engagement = predict_pd_coupling(l1=L1, ivive=IVIVE)
    result = rank_therapeutic_index(
        pd_coupling=engagement,
        safety_stage=SAFETY,
        measured_safety_concentrations={"herg_ic50_nm": 12000.0},
    )
    margin = result["computed_margins"][0]
    # Efficacy anchor is the 50% occupancy concentration, which equals Kd = 5 nM.
    assert margin["margin_fold"] == pytest.approx(2400.0)
    assert margin["band"] == "wide"
    assert result["limiting_margin"]["id"] == "herg"


def test_overlapping_concentrations_are_banded_critical():
    engagement = predict_pd_coupling(l1=L1, ivive=IVIVE)
    result = rank_therapeutic_index(
        pd_coupling=engagement,
        safety_stage=SAFETY,
        measured_safety_concentrations={"herg_ic50_nm": 10.0},
    )
    assert result["computed_margins"][0]["band"] == "critical"


def test_index_refuses_without_an_efficacy_anchor():
    result = rank_therapeutic_index(pd_coupling={"available": False}, safety_stage=SAFETY)
    assert result["available"] is False


# ── Stage 9: confirmation block ──────────────────────────────────────────────


def test_full_evidence_confirms_with_named_reservations():
    engagement = predict_pd_coupling(l1=L1, ivive=IVIVE)
    index = rank_therapeutic_index(
        pd_coupling=engagement,
        safety_stage=SAFETY,
        measured_safety_concentrations={"herg_ic50_nm": 12000.0},
    )
    block = build_confirmation_block(
        l1=L1,
        stage_results={
            "1": {"prediction": {"druggability_class": "druggable"}},
            "6": {"source": "ivive"},
            "7": engagement,
            "8": index,
        },
    )
    assert block["counts"]["block"] == 0
    assert block["verdict"] == "CONFIRMED-WITH-RESERVATIONS"
    assert block["evidence_completeness"]["stages_with_a_usable_result"] == 4


def test_critical_margin_blocks_confirmation():
    engagement = predict_pd_coupling(l1=L1, ivive=IVIVE)
    index = rank_therapeutic_index(
        pd_coupling=engagement,
        safety_stage=SAFETY,
        measured_safety_concentrations={"herg_ic50_nm": 10.0},
    )
    block = build_confirmation_block(l1=L1, stage_results={"7": engagement, "8": index})
    assert block["verdict"] == "NOT-CONFIRMED"
    assert block["counts"]["block"] >= 1


def test_unreviewed_watch_verdict_blocks_confirmation():
    block = build_confirmation_block(
        l1={"verdict": {"verdict": "WATCH"}, "review": None}, stage_results={}
    )
    assert block["verdict"] == "NOT-CONFIRMED"
    assert any(item["code"] == "L1_REVIEW_MISSING" for item in block["conditions"])


def test_missing_engagement_blocks_confirmation():
    block = build_confirmation_block(l1=L1, stage_results={})
    assert any(item["code"] == "ENGAGEMENT_MISSING" for item in block["conditions"])
    assert block["verdict"] == "NOT-CONFIRMED"
