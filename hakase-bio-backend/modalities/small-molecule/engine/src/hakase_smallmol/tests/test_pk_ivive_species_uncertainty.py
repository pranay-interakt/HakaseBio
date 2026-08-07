"""Tests for the S1-T5 pk_ivive extensions: species system params, renal/total
clearance, and the Monte-Carlo uncertainty wrapper.

Guarantees: the pure ``compute_ivive`` core is unchanged; the deterministic path
still works; provenance tags and the no-fallback envelope are preserved.

Inputs are supplied directly (overrides / ml_inputs) so no ADMET ML model is
loaded. Run:
    pytest modalities/small-molecule/engine/src/hakase_smallmol/tests/test_pk_ivive_species_uncertainty.py -q
"""

from __future__ import annotations

import pytest

from hakase_smallmol.pk_ivive import pk_ivive as M

# A full set of inputs (all four keys) so the wrapper never calls the ADMET model.
_ML = {
    "clint_hep_ul_min_1e6": 20.0,
    "fu_plasma": 0.1,
    "vdss_l_per_kg": 0.7,
    "half_life_obach_h": 5.0,
}


# --------------------------------------------------------------------------- #
# The pure core is untouched
# --------------------------------------------------------------------------- #


def test_compute_ivive_core_is_pinned():
    # Locks the pure-core arithmetic (human default constants) so S1-T5 changes
    # cannot silently perturb it.
    out = M.compute_ivive(clint_hep_ul_min_1e6=20.0, fu_plasma=0.1, vdss_l_per_kg=0.7)
    assert out["clint_invivo_ml_min_kg"] == pytest.approx(50.886)  # 20*99*25.7/1000
    assert out["cl_hepatic_plasma_ml_min_kg"] == pytest.approx(4.0845, abs=1e-4)
    # The core does NOT know about renal/total CL (added only in the wrapper).
    assert "cl_renal_plasma_ml_min_kg" not in out


# --------------------------------------------------------------------------- #
# (1) System parameters sourced from the kernel store, keyed by species
# --------------------------------------------------------------------------- #


def test_human_system_params_reproduce_legacy_constants():
    sp = M.resolve_system_parameters("human")
    assert sp.q_h_ml_min_kg == M.HEPATIC_BLOOD_FLOW_ML_MIN_KG == 20.7
    assert sp.hpgl_1e6_per_g == M.HEPATOCELLULARITY_1E6_PER_G == 99.0
    assert sp.liver_g_per_kg == pytest.approx(M.LIVER_WEIGHT_G_PER_KG) == pytest.approx(25.7)
    assert sp.body_weight_kg == M.DEFAULT_BODY_WEIGHT_KG == 70.0
    assert sp.hpgl_provenance == "reference" and sp.warnings == []


def test_human_deterministic_matches_pure_core():
    res = M.predict_pk_ivive("CCO", ml_inputs=_ML)
    assert res["source"] == "ivive" and res["available"] is True
    core = M.compute_ivive(clint_hep_ul_min_1e6=20.0, fu_plasma=0.1, vdss_l_per_kg=0.7)
    assert res["parameters"]["cl_hepatic_plasma_ml_min_kg"] == core["cl_hepatic_plasma_ml_min_kg"]
    # System-parameters block is store-sourced but numerically identical for human.
    sysp = res["system_parameters"]
    assert sysp["hepatic_blood_flow_ml_min_kg"]["value"] == 20.7
    assert sysp["hepatocellularity_1e6_per_g"]["value"] == 99.0
    assert sysp["liver_weight_g_per_kg"]["value"] == pytest.approx(25.7)


def test_runs_per_species_with_store_values():
    rat = M.resolve_system_parameters("rat")
    assert rat.species == "rat" and rat.strain == "sprague_dawley"
    assert rat.q_h_ml_min_kg == 70.0 and rat.gfr_ml_min_kg == 5.5
    # Rat hepatocellularity is now established (120e6/g, Houston & Carlile 1997) —
    # a reference value, not the assumed-human fallback, and no warning is raised.
    assert rat.hpgl_1e6_per_g == 120.0
    assert rat.hpgl_provenance == "reference"
    assert not any("hepatocellularity" in w for w in rat.warnings)
    res = M.predict_pk_ivive("CCO", ml_inputs=_ML, species="rat")
    assert res["species"] == "rat"
    assert not any("hepatocellularity" in w for w in res.get("system_warnings", []))


def test_unknown_species_is_input_error():
    res = M.predict_pk_ivive("CCO", ml_inputs=_ML, species="unicorn")
    assert res["source"] == "input-error" and res["available"] is False
    with pytest.raises(ValueError):
        M.resolve_system_parameters("unicorn")


# --------------------------------------------------------------------------- #
# (2) Renal clearance (GFR*fu) and total CL
# --------------------------------------------------------------------------- #


def test_renal_clearance_is_gfr_times_fu():
    assert M.compute_renal_clearance(1.8, 0.1) == pytest.approx(0.18)
    with pytest.raises(ValueError):
        M.compute_renal_clearance(1.8, 0.0)
    with pytest.raises(ValueError):
        M.compute_renal_clearance(-1.0, 0.1)


def test_total_clearance_is_hepatic_plus_renal():
    res = M.predict_pk_ivive("CCO", ml_inputs=_ML)  # human GFR 1.8, fu 0.1 -> renal 0.18
    p = res["parameters"]
    assert p["cl_renal_plasma_ml_min_kg"] == pytest.approx(0.18)
    assert p["cl_total_plasma_ml_min_kg"] == pytest.approx(p["cl_hepatic_plasma_ml_min_kg"] + 0.18)
    assert "filtration only" in p["renal_clearance_note"]


# --------------------------------------------------------------------------- #
# (3) Monte-Carlo wrapper: intervals, reproducibility, provenance-driven width
# --------------------------------------------------------------------------- #


def test_montecarlo_reports_median_and_intervals():
    res = M.predict_pk_ivive("CCO", ml_inputs=_ML, montecarlo=True, mc_samples=2000, mc_seed=1)
    unc = res["uncertainty"]
    assert unc["n_samples"] == 2000 and unc["seed"] == 1 and unc["coverage"] == 0.90
    dist = unc["distributions"]["cl_total_plasma_ml_min_kg"]
    # ML inputs -> real spread; median near the deterministic point.
    assert dist["ci_low"] < dist["median"] < dist["ci_high"]
    assert dist["median"] == pytest.approx(res["parameters"]["cl_total_plasma_ml_min_kg"], rel=0.15)
    # half-life interval present too (vdss supplied).
    assert "half_life_h" in unc["distributions"]


def test_montecarlo_is_seed_reproducible():
    a = M.predict_pk_ivive("CCO", ml_inputs=_ML, montecarlo=True, mc_samples=1000, mc_seed=99)
    b = M.predict_pk_ivive("CCO", ml_inputs=_ML, montecarlo=True, mc_samples=1000, mc_seed=99)
    assert a["uncertainty"]["distributions"] == b["uncertainty"]["distributions"]


def test_measured_inputs_contribute_no_width():
    # All inputs measured (overrides) -> provenance "measured" -> zero model error.
    res = M.predict_pk_ivive("CCO", overrides=_ML, montecarlo=True, mc_samples=500, mc_seed=3)
    dist = res["uncertainty"]["distributions"]["cl_hepatic_plasma_ml_min_kg"]
    assert dist["ci_low"] == dist["median"] == dist["ci_high"]
    assert res["uncertainty"]["residual_models"]["fu_plasma"]["provenance"] == "measured"


def test_montecarlo_default_off():
    res = M.predict_pk_ivive("CCO", ml_inputs=_ML)
    assert "uncertainty" not in res  # deterministic path unchanged by default


# --------------------------------------------------------------------------- #
# (4) Provenance + no-fallback envelope preserved exactly
# --------------------------------------------------------------------------- #


def test_provenance_tags_preserved():
    res = M.predict_pk_ivive(
        "CCO",
        overrides={"clint_hep_ul_min_1e6": 20.0},  # measured
        ml_inputs={"fu_plasma": 0.1, "vdss_l_per_kg": 0.7, "half_life_obach_h": 5.0},  # ml
    )
    inputs = res["inputs"]
    assert inputs["clint_hep_ul_min_1e6"]["provenance"] == "measured"
    assert inputs["fu_plasma"]["provenance"] == "ml"


def test_insufficient_input_envelope_preserved(monkeypatch):
    # clint/fu absent and the ADMET model forced offline -> the no-fallback
    # envelope (vdss alone can't satisfy clint+fu). Force ML off so the test is
    # deterministic whether or not the ADMET weights are present in the env.
    monkeypatch.setattr(
        "hakase_smallmol.admet.admet_ml.predict_admet_ml",
        lambda *a, **k: {"ml_available": False, "source": "unavailable"},
    )
    res = M.predict_pk_ivive("CCO", ml_inputs={"vdss_l_per_kg": 0.7})
    assert res["source"] == "insufficient-input"
    assert res["available"] is False
    assert "clint_hep_ul_min_1e6" in res["missing"] or "fu_plasma" in res["missing"]
    assert "remediation" in res


def test_invalid_smiles_is_input_error():
    res = M.predict_pk_ivive("   ")
    assert res["source"] == "input-error" and res["available"] is False


# --------------------------------------------------------------------------- #
# (5) Cross-species low-confidence signal: human-trained ML CLint/fu are not
#     predictive for non-human species (handoff §3.4, Spearman 0.21).
# --------------------------------------------------------------------------- #


def test_non_human_ml_inputs_carry_low_confidence_flag():
    # rat + all inputs "ml" (human-trained ADMET) -> explicit low-confidence signal.
    res = M.predict_pk_ivive("CCO", ml_inputs=_ML, species="rat")
    conf = res["confidence"]
    assert conf["level"] == "low"
    assert "cross_species_ml_clint_unreliable" in conf["flags"]
    assert "clint_hep_ul_min_1e6" in conf["ml_driven_inputs"]
    # Rationale names the concrete limitation and cites the handoff evidence.
    assert "rat" in conf["rationale"] and "0.21" in conf["rationale"]
    assert "pbpk-s2t5-validation-handoff" in conf["reference"]
    # Folded into the warnings the result already carries (non-breaking channel).
    assert any("0.21" in w for w in res.get("system_warnings", []))


def test_human_ml_inputs_are_not_low_confidence():
    # Same ML inputs, human species -> nominal, no flag.
    res = M.predict_pk_ivive("CCO", ml_inputs=_ML, species="human")
    assert res["confidence"]["level"] == "nominal"
    assert res["confidence"]["flags"] == []
    assert not any("0.21" in w for w in res.get("system_warnings", []))


def test_non_human_measured_inputs_are_not_low_confidence():
    # rat but CLint/fu supplied as measured overrides -> no cross-species flag.
    res = M.predict_pk_ivive("CCO", overrides=_ML, species="rat")
    assert res["confidence"]["level"] == "nominal"
    assert res["confidence"]["flags"] == []


def test_non_human_measured_clint_ml_fu_still_flags_on_fu():
    # Only CLint measured; fu still human-trained ML -> flag fires on fu alone.
    res = M.predict_pk_ivive(
        "CCO",
        overrides={"clint_hep_ul_min_1e6": 20.0},
        ml_inputs={"fu_plasma": 0.1, "vdss_l_per_kg": 0.7, "half_life_obach_h": 5.0},
        species="rat",
    )
    conf = res["confidence"]
    assert conf["level"] == "low"
    assert conf["ml_driven_inputs"] == ["fu_plasma"]
