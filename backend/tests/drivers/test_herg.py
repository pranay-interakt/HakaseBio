"""hERG driver: conformance, exact IC50 recovery, Q&A 1.2 margin, Q&A 2.1 controls."""


import pytest
from pydantic import ValidationError

from hos.core.descriptors import compute_profile
from hos.core.quantity import Quantity
from hos.drivers.base import CompoundInfo
from hos.drivers.conformance import check_driver
from hos.drivers.herg import HergPatchClampDriver

D = HergPatchClampDriver()
_prof = compute_profile("CC(=O)Oc1ccccc1C(=O)O")
COMPOUND = CompoundInfo(id="cmp-1", name="Test compound", smiles=_prof.canonical_smiles,
                        molecular_weight=_prof.molecular_weight)

PARAMS = dict(
    glp=True, cell_line="HEK293 stably expressing hERG", platform="manual",
    recording_temperature_C=36.0, stimulation_frequency_Hz=0.2,
    voltage_protocol="ventricular action-potential-like waveform",
    selective_blocker="E-4031 (saturating)", vehicle="0.1% DMSO",
    test_concentrations_uM=[0.1, 0.3, 1, 3, 10, 30], cells_per_concentration=3,
    concentration_verification=True, positive_control="dofetilide",
    positive_control_concentrations_uM=[0.01, 0.03],
    positive_control_expected_block=[
        {"concentration_uM": 0.01, "low_percent": 20, "high_percent": 80},
        {"concentration_uM": 0.03, "low_percent": 30, "high_percent": 90}],
    positive_control_basis="test lab historical data, SOP-H-7",
    constrain_asymptotes_0_100=True, acceptance_min_r2=0.9, acceptance_basis="test SOP-H-7",
)
SIM = dict(ic50_uM=2.0, hill=1.0, positive_control_ic50_uM=0.015, positive_control_hill=1.0,
           baseline_current_pA=800.0, background_fraction=0.05, inhibition_noise_sd_percent=0.0,
           vehicle_rundown_percent=2.0, temperature_C=36.0)
INPUTS = {"cmax_total_high_clinical_exposure": Quantity.measured(0.5, "uM", source_name="FIH PK"),
          "fu_plasma": Quantity.measured(0.004, "dimensionless", source_name="PPB")}


def _measured(sim=SIM, ref="HOS-CONFORMANCE-1"):
    """Exact (noise-free) currents in the measured format, from the declared model (test input)."""
    p = D.validate_parameters(PARAMS)
    lines = ["# laboratory: Test Lab", "# analyst: P. Clamp", "# run_date: 2026-09-30",
             f"# study_reference: {ref}",
             "cell_id,article,nominal_concentration [uM],measured_concentration [uM],"
             "baseline_current [pA],drug_current [pA],background_current [pA],temperature [degC],"
             "steady_state"]
    for m in D._manifest(p):
        c = float(m["nominal_concentration_uM"])
        if m["article"] == "TA":
            inh = 100 / (1 + (sim["ic50_uM"] / c) ** sim["hill"])
        elif m["article"] == "PC":
            inh = 100 / (1 + (sim["positive_control_ic50_uM"] / c) ** sim["positive_control_hill"])
        else:
            inh = sim["vehicle_rundown_percent"]
        bg = 40.0
        drug = bg + (800.0 - bg) * (1 - inh / 100)
        meas = f"{c!r}" if m["article"] == "TA" else ""
        lines.append(f"{m['cell_id']},{m['article']},{c!r},{meas},800.0,{drug!r},{bg!r},36.0,yes")
    return ("\n".join(lines) + "\n").encode()


def test_conformance_kit_passes():
    rep = check_driver(D, compound=COMPOUND, parameters=PARAMS, simulation_parameters=SIM,
                       measured_example=_measured(), analysis_inputs=INPUTS)
    assert rep.passed, rep.summary()


def test_exact_ic50_and_qa12_margin_with_fu_floor():
    p = D.validate_parameters(PARAMS)
    res = D.analyze(D.ingest(_measured(), p), p, COMPOUND, INPUTS)
    q = res.quantities
    assert q["ic50"].value == pytest.approx(2.0, rel=1e-4)
    assert q["hill"].value == pytest.approx(1.0, rel=1e-3)
    # Q&A 2.1 item 4: IC50 in ng/mL = uM x g/mol
    assert q["ic50_ng_per_mL"].value == pytest.approx(2.0 * 180.159, rel=1e-3)
    # Q&A 1.2: fu 0.4% < 1% -> floored to 1%; free Cmax = 0.5 uM x 0.01
    assert q["free_cmax"].value == pytest.approx(0.005)
    assert "fu_floored_at_1_percent" in q["free_cmax"].qc_flags
    assert q["margin"].value == pytest.approx(2.0 / 0.005, rel=1e-4)
    # dofetilide at 0.01 and 0.03 uM with IC50 0.015 -> 40% and 66.7% block
    assert q["positive_control.0.01uM"].value == pytest.approx(40.0, rel=1e-9)
    assert q["positive_control.0.03uM"].value == pytest.approx(200 / 3, rel=1e-9)
    assert q["vehicle_inhibition"].value == pytest.approx(2.0, rel=1e-9)
    assert res.qc.passed


def test_positive_control_out_of_range_makes_study_inconclusive():
    p = D.validate_parameters(PARAMS)
    raw = _measured(dict(SIM, positive_control_ic50_uM=1.0))  # ~1-3% block
    res = D.analyze(D.ingest(raw, p), p, COMPOUND, INPUTS)
    assert not res.qc.passed
    interp = D.interpret(res, p)
    assert any("inconclusive" in s.statement for s in interp.statements)


def test_no_threshold_means_expert_judgement_not_a_verdict():
    p = D.validate_parameters(PARAMS)
    res = D.analyze(D.ingest(_measured(), p), p, COMPOUND, INPUTS)
    interp = D.interpret(res, p)
    assert any("No protocol-specific threshold" in s.statement for s in interp.statements)
    assert any("margin indicates" in j for j in interp.requires_expert_judgement)


def test_threshold_requires_basis_and_is_applied():
    with pytest.raises(ValidationError):
        D.validate_parameters(dict(PARAMS, margin_threshold=51))
    p = D.validate_parameters(dict(PARAMS, margin_threshold=1000,
                                   margin_threshold_basis="lab reference set, pooled upper bound"))
    res = D.analyze(D.ingest(_measured(), p), p, COMPOUND, INPUTS)
    assert any("not above the protocol-specific threshold" in s.statement
               for s in D.interpret(res, p).statements)


def test_best_practice_deviation_is_reported():
    p = D.validate_parameters(dict(PARAMS, recording_temperature_C=22.0,
                                   stimulation_frequency_Hz=0.1))
    proto = D.design(COMPOUND, p)
    comp = proto.design["best_practice_compliance"]
    assert sum("NOT MET" in v for v in comp.values()) == 2


def test_margin_unavailable_without_exposure():
    p = D.validate_parameters(PARAMS)
    res = D.analyze(D.ingest(_measured(), p), p, COMPOUND, {})
    assert not res.quantities["margin"].is_available
