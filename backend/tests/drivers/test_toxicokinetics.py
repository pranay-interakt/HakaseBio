"""Toxicokinetics driver (ICH S3A; ISR per ICH M10 section 5)."""

import csv
import io

import numpy as np
import pytest
from pydantic import ValidationError

from hos.core.nca import auc
from hos.core.quantity import Quantity
from hos.drivers.base import CompoundInfo, IngestError
from hos.drivers.conformance import check_driver
from hos.drivers.toxicokinetics import ToxicokineticsDriver

D = ToxicokineticsDriver()
COMPOUND = CompoundInfo(id="cmp-1", name="Test compound", smiles="CC(=O)Nc1ccc(O)cc1")
TIMES = [0, 0.5, 1, 2, 4, 8, 24]
REF = [0, 50, 80, 60, 40, 20, 5]  # true day-1 concentrations (ng/mL) at the reference dose
PARAMS = dict(
    glp=True,
    parent_study="TOX-28D-RAT",
    species="rat",
    strain="Sprague-Dawley",
    route="oral gavage",
    administration="extravascular",
    analyte="test compound",
    matrix="plasma",
    bioanalytical_technique="chromatographic",
    bioanalytical_method_reference="BMV-001",
    concentration_unit="ng/mL",
    lloq=1.0,
    dose_unit="mg/kg/day",
    dose_levels=[10, 30, 100],
    control_group_assayed=True,
    sexes=["M", "F"],
    animals_per_sex_per_group=3,
    satellite_groups=True,
    dosing_interval_h=24,
    profile_days=[1, 28],
    sampling="profile",
    sampling_times_h=TIMES,
    sampling_justification="profile over the dosing interval",
    auc_method="linear",
    auc_method_basis="TK SOP-7",
    blq_rule="leading_zero_then_excluded",
    dose_proportionality=dict(
        theta_low=0.8, theta_high=1.25, ci_level=0.9, basis="pre-specified in the study plan"
    ),
)
SIM = dict(
    reference_dose=10,
    reference_profile=[{"time_h": t, "concentration": c} for t, c in zip(TIMES, REF, strict=True)],
    dose_exponent=1.0,
    day_factor={"1": 1.0, "28": 1.5},
    sex_factor={"M": 1.0, "F": 1.2},
    between_animal_sd_log=0.0,
    residual_sd_log=0.0,
    isr_fraction=0.1,
    isr_sd_log=0.0,
)


def _file(params=None, sim=None, edit=None, ref="HOS-CONFORMANCE-1"):
    """Lab-format file built from a declared exposure model (test input)."""
    p = D.validate_parameters(params or PARAMS)
    s = D.simulation_parameters_model().model_validate(sim or SIM)
    rows, _ = D._simulate_rows(p, COMPOUND, s, np.random.default_rng(0))
    if edit:
        rows = edit(rows)
    t = D.data_template(p)
    buf = io.StringIO()
    buf.write(
        f"# laboratory: TK Lab\n# analyst: T. Analyst\n# run_date: 2026-09-30\n"
        f"# study_reference: {ref}\n"
    )
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(t.header())
    for r in rows:
        w.writerow(["" if r.get(c.name) is None else r[c.name] for c in t.columns])
    return buf.getvalue().encode()


def _analyze(raw, params=None, inputs=None):
    p = D.validate_parameters(params or PARAMS)
    return D.analyze(D.ingest(raw, p), p, COMPOUND, inputs), p


def test_conformance_kit_passes():
    rep = check_driver(
        D,
        compound=COMPOUND,
        parameters=PARAMS,
        simulation_parameters=dict(
            SIM, between_animal_sd_log=0.2, residual_sd_log=0.1, isr_sd_log=0.05
        ),
        measured_example=_file(),
    )
    assert rep.passed, rep.summary()


def test_noise_free_exposure_matches_the_declared_model_exactly():
    res, _ = _analyze(_file())
    q = res.quantities
    ref_auc = auc(TIMES, REF, "linear")  # independent trapezoid of the declared profile
    for dose in (10, 30, 100):
        f = dose / 10
        assert q[f"mean.cmax.{dose}.M.day1"].value == pytest.approx(80 * f, rel=1e-12)
        assert q[f"mean.auc_tau.{dose}.M.day1"].value == pytest.approx(ref_auc * f, rel=1e-12)
        assert q[f"mean.auc_tau.{dose}.F.day28"].value == pytest.approx(
            ref_auc * f * 1.2 * 1.5, rel=1e-12
        )
        assert q[f"ratio.auc_tau.{dose}.M.day28"].value == pytest.approx(1.5, rel=1e-12)
    b1 = q["dp.auc_tau.M.day1.beta1"]
    assert b1.value == pytest.approx(1.0, abs=1e-12)
    assert b1.uncertainty.kind == "ci90"
    dp = next(t for t in res.tables if t.title.startswith("Dose proportionality"))
    assert all(str(r[-1]) == "criterion met" for r in dp.rows)
    assert q["mean.auc_tau.30.M.day1"].unit == "ng/mL*h"


def test_less_than_proportional_exposure_fails_the_criterion_and_is_flagged():
    res, p = _analyze(_file(sim=dict(SIM, dose_exponent=0.6)))
    assert res.quantities["dp.cmax.M.day1.beta1"].value == pytest.approx(0.6, abs=1e-12)
    dp = next(t for t in res.tables if t.title.startswith("Dose proportionality"))
    assert all(str(r[-1]).startswith("criterion not met") for r in dp.rows)
    interp = D.interpret(res, p)
    assert any("ICH S3A 3.4.3" in s.basis for s in interp.statements)


def test_isr_meets_m10_when_repeats_agree():
    res, _ = _analyze(_file())
    assert res.quantities["isr.fraction_within"].value == pytest.approx(100.0)
    assert not [f for f in res.qc.findings if f.code.startswith("isr.")]


def test_isr_failure_is_reported_with_its_m10_section():
    res, _ = _analyze(_file(sim=dict(SIM, isr_sd_log=0.9)))
    fail = [f for f in res.qc.findings if f.code == "isr.criterion"]
    assert fail and "ICH M10 section 5" in fail[0].message
    assert not res.qc.passed


def test_ligand_binding_isr_limit_is_30_percent():
    p = D.validate_parameters(dict(PARAMS, bioanalytical_technique="ligand_binding"))
    assert p.isr_criterion().value == 30 and p.reanalysis_section() == "4.3.4"


def test_missing_isr_is_a_warning():
    res, _ = _analyze(_file(sim=dict(SIM, isr_fraction=0.0)))
    assert [f for f in res.qc.findings if f.code == "isr.absent"]


def test_quantifiable_control_and_predose_samples_are_flagged():
    def contaminate(rows):
        for r in rows:
            if (r["dose"] == 0 and r["nominal_time"] == 2) or (
                r["dose"] == 10 and r["day"] == 1 and r["nominal_time"] == 0
            ):
                r.update(concentration=3.0, blq="no")
        return rows

    res, _ = _analyze(_file(edit=contaminate))
    codes = {f.code: f.message for f in res.qc.findings}
    assert "ICH M10 3.3.4" in codes["control.quantifiable"]
    assert "pre-dose" in codes["predose.quantifiable"]


def test_exposure_multiples_over_human_exposure():
    inputs = {
        "human_auc": Quantity.user_supplied(1000.0, "ng/mL*h", actor="t"),
        "human_cmax": Quantity.user_supplied(0.1, "ug/mL", actor="t"),
    }
    res, p = _analyze(_file(), inputs=inputs)
    q = res.quantities
    expect = q["mean.auc_tau.10.M.day28"].value / 1000.0
    assert q["multiple.auc_tau.10.M"].value == pytest.approx(expect, rel=1e-12)
    assert q["multiple.cmax.10.M"].value == pytest.approx(80 * 1.5 / 100.0, rel=1e-12)
    assert any("ICH S3A 3.4.1" in s.basis for s in D.interpret(res, p).statements)


def test_monitoring_design_reports_no_auc():
    params = dict(PARAMS, sampling="monitor", sampling_times_h=[2, 24], dose_proportionality=None)
    sim = dict(
        SIM,
        reference_profile=[{"time_h": 2, "concentration": 60}, {"time_h": 24, "concentration": 5}],
    )
    res, _ = _analyze(_file(params, sim), params)
    q = res.quantities
    assert "mean.auc_last.10.M.day1" not in q and q["mean.cmax.10.M.day1"].value == 60
    ind = next(t for t in res.tables if t.title == "Individual exposure")
    assert "S3A Note 1" in ind.rows[-1][8].provenance.reason


def test_strict_ingest_rejects_inconsistent_samples():
    def bad(rows):
        rows[1].update(concentration=0.5, blq="no")  # below the LLOQ, reported quantified
        rows[2].update(concentration=4.0, blq="yes")  # BLQ with a value
        rows[3]["dose"] = 50  # not a protocol group
        rows.append(dict(rows[4]))  # duplicate sample
        return rows

    with pytest.raises(IngestError) as exc:
        D.ingest(_file(edit=bad), D.validate_parameters(PARAMS))
    msg = " ".join(exc.value.errors)
    for text in (
        "below the LLOQ",
        "BLQ sample has no concentration",
        "not a protocol group",
        "duplicate sample",
    ):
        assert text in msg


def test_design_rules_from_s3a_and_fda():
    with pytest.raises(ValidationError, match=r"ICH S3A 3\.5"):
        D.validate_parameters(dict(PARAMS, sexes=["M"]))
    D.validate_parameters(
        dict(PARAMS, sexes=["M"], single_sex_justification="male-only indication")
    )
    with pytest.raises(ValidationError, match="time 0"):
        D.validate_parameters(dict(PARAMS, sampling_times_h=[0.5, 1, 24]))
    with pytest.raises(ValidationError):
        D.validate_parameters(dict(PARAMS, dose_levels=[0, 10]))


def test_determinations_and_prerequisite():
    p = D.validate_parameters(PARAMS)
    dets = {d.key: d for d in D.expert_determinations(p)}
    assert dets["exposure_adequacy"].choices == ("adequate", "not_adequate")
    assert dets["exposure_adequacy"].required_for_approval
    assert not dets["steady_state"].required_for_approval
    one_day = D.validate_parameters(dict(PARAMS, profile_days=[1]))
    assert [d.key for d in D.expert_determinations(one_day)] == ["exposure_adequacy"]
    assert [x.requirement_id for x in D.prerequisites(p)] == ["bioanalytical.validation"]


def test_protocol_records_log_transform_rationale_and_blq_rule():
    proto = D.design(COMPOUND, D.validate_parameters(PARAMS))
    notes = " ".join(proto.design["design_notes"])
    assert "ICH S3A 3.9" in notes and "ln-ln" in notes
    assert "BLQ at or before the first quantifiable" in proto.design["nca"]
    assert D.ctd_section == "4.2.3.2"
