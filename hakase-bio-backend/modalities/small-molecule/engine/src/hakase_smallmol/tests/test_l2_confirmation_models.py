from __future__ import annotations

from hakase_smallmol.l1.pipeline import _stage_gate
from hakase_smallmol.l2 import pipeline


def _contract() -> dict:
    return {
        "l1": {"canonical_smiles": "CCO", "uniprot_id": "P12345"},
        "stages": [
            {"id": "3", "name": "ADME", "status": "ready"},
            {"id": "4", "name": "Safety", "status": "ready"},
        ],
    }


def test_stage_three_runs_and_presents_independent_adme_models(monkeypatch):
    monkeypatch.setattr(pipeline, "l2_input_contract", lambda _analysis_id: _contract())
    monkeypatch.setattr(
        pipeline,
        "predict_binding_ml",
        lambda *_args: {"ml_available": True, "prediction": {"pKd_predicted": 7.1}},
    )
    monkeypatch.setattr(
        pipeline,
        "predict_admet_ml",
        lambda *_args: {
            "ml_available": True,
            "endpoints": {"Caco2_Wang": -5.0},
            "model_info": {"engine": "ADMET-AI", "endpoint_count": 41},
        },
    )
    monkeypatch.setattr(
        pipeline,
        "predict_caco2_ml",
        lambda *_args: {
            "ml_available": True,
            "prediction": {"log_papp": -5.1, "permeability_class": "high"},
        },
    )
    monkeypatch.setattr(
        pipeline,
        "predict_solubility_ml",
        lambda *_args: {
            "ml_available": True,
            "prediction": {"logS_predicted": -3.2, "solubility_class": "high"},
        },
    )
    monkeypatch.setattr(
        pipeline,
        "predict_vdss_ml",
        lambda *_args: {
            "ml_available": True,
            "prediction": {"vdss_l_per_kg": 1.5, "distribution_class": "moderate"},
        },
    )
    monkeypatch.setattr(
        pipeline,
        "predict_half_life_ml",
        lambda *_args: {
            "ml_available": True,
            "prediction": {"half_life_hours": 4.2, "half_life_class": "moderate"},
        },
    )

    response = pipeline.run_l2_stage("analysis-1", "3")

    assert response["status"] == "available"
    assert set(response["result"]) == {
        "binding_ml",
        "admet_ml",
        "caco2_ml",
        "solubility_ml",
        "vdss_ml",
        "half_life_ml",
    }
    assert any(
        group["title"] == "Independent ADME and disposition models"
        for group in response["presentation"]["groups"]
    )


def test_stage_four_runs_and_presents_independent_safety_models(monkeypatch):
    monkeypatch.setattr(pipeline, "l2_input_contract", lambda _analysis_id: _contract())
    monkeypatch.setattr(
        pipeline,
        "predict_safety_triage",
        lambda *_args: {"ml_available": True, "triage": {"tier": "CLEAR"}, "endpoints": {}},
    )
    monkeypatch.setattr(
        pipeline,
        "predict_tox21_panel",
        lambda *_args: {"ml_available": True, "summary": {"n_assays_evaluated": 12}},
    )
    monkeypatch.setattr(
        pipeline,
        "predict_cardiotox",
        lambda *_args: {"ml_available": True, "prediction": {"blocker_probability": 0.1}},
    )
    monkeypatch.setattr(
        pipeline,
        "predict_dili_ml",
        lambda *_args: {"ml_available": True, "prediction": {"dili_probability": 0.2}},
    )
    monkeypatch.setattr(
        pipeline,
        "predict_ames_ml",
        lambda *_args: {"ml_available": True, "prediction": {"mutagenic_probability": 0.3}},
    )
    monkeypatch.setattr(
        pipeline,
        "predict_reactive_metabolites",
        lambda *_args: {"rm_class": "Negligible", "alert_count": 0},
    )

    response = pipeline.run_l2_stage("analysis-1", "4")

    assert response["status"] == "available"
    assert {"cardiotox", "dili_ml", "ames_ml", "reactive_metabolites"} <= set(response["result"])
    assert any(
        group["title"] == "Independent safety models"
        for group in response["presentation"]["groups"]
    )


def test_layer_one_gate_requires_review_when_toxicity_screen_is_not_requested():
    gate = _stage_gate(
        {"lipinski_rule_of_five_pass": True},
        {"status": "available"},
        {"prediction": {}},
        {"prediction": {}},
        toxicity_signal_detection=False,
    )

    assert gate["verdict"] == "WATCH"
    assert {"Cardiac-safety screening", "DILI screening"} <= set(gate["missing_evidence"])
