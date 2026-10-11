"""Bioanalytical method validation driver (ICH M10 section 3)."""

import csv
import io

import numpy as np
import pytest
from pydantic import ValidationError

from hos.drivers.base import CompoundInfo
from hos.drivers.bioanalytical_validation import BioanalyticalValidationDriver
from hos.drivers.conformance import check_driver

D = BioanalyticalValidationDriver()
COMPOUND = CompoundInfo(id="cmp-1", name="Test compound", smiles="CC(=O)Nc1ccc(O)cc1")
PARAMS = dict(
    glp=True,
    analyte="test compound",
    internal_standard="d4-test compound",
    matrix="rat plasma (K2EDTA)",
    species="rat",
    technique="LC-MS/MS",
    concentration_unit="ng/mL",
    regression_model="linear",
    weighting="1/x^2",
    regression_basis="test SOP BA-12 rev 3",
    calibration_levels=[1, 2, 5, 20, 100, 400, 800, 1000],
    qc_levels={"LLOQ": 1, "LQC": 3, "MQC": 400, "HQC": 800},
    accuracy_precision_runs=3,
    accuracy_precision_replicates=5,
    selectivity_sources=6,
    matrix_effect_sources=6,
    matrix_effect_replicates=3,
    dilution_factors=[10],
    dilution_replicates=5,
    stability_tests=[
        {
            "name": "FT3",
            "kind": "freeze_thaw",
            "condition": "-70 C / room temp",
            "duration": "3 cycles",
            "cycles": 3,
        },
        {"name": "BT6", "kind": "bench_top", "condition": "room temperature", "duration": "6 h"},
    ],
    stability_replicates=3,
)
SIM = dict(
    slope=0.01,
    intercept=0.0005,
    is_response=1.0e5,
    response_cv=0.0,
    blank_fraction_of_lloq=0.05,
    blank_is_fraction=0.01,
    carryover_fraction_of_lloq=0.02,
    matrix_lot_cv=0.0,
    dilution_bias_percent=0.0,
    stability_loss_percent={"FT3": 0.0, "BT6": 0.0},
)


def _measured(sim=SIM, ref="HOS-CONFORMANCE-1", edit=None):
    """Lab-format file built from the declared response model (test input)."""
    p = D.validate_parameters(PARAMS)
    s = D.simulation_parameters_model().model_validate(sim)
    rows, _ = D._simulate_rows(p, COMPOUND, s, np.random.default_rng(0))
    if edit:
        rows = edit(rows)
    t = D.data_template(p)
    buf = io.StringIO()
    buf.write(
        f"# laboratory: BA Lab\n# analyst: B. Analyst\n# run_date: 2026-09-30\n"
        f"# study_reference: {ref}\n"
    )
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(t.header())
    for r in rows:
        w.writerow(["" if r.get(c.name) is None else r[c.name] for c in t.columns])
    return buf.getvalue().encode()


def _analyze(raw):
    p = D.validate_parameters(PARAMS)
    return D.analyze(D.ingest(raw, p), p, COMPOUND), p


def test_conformance_kit_passes():
    rep = check_driver(
        D,
        compound=COMPOUND,
        parameters=PARAMS,
        simulation_parameters=dict(SIM, response_cv=0.03, matrix_lot_cv=0.02),
        measured_example=_measured(),
    )
    assert rep.passed, rep.summary()


def test_noise_free_method_meets_every_m10_criterion_exactly():
    res, _ = _analyze(_measured())
    assert res.qc.passed, [f.message for f in res.qc.findings]
    q = res.quantities
    for lvl in ("LLOQ", "LQC", "MQC", "HQC"):
        assert q[f"ap.{lvl}.between_run_accuracy"].value == pytest.approx(100.0, abs=1e-6)
        assert q[f"ap.{lvl}.between_run_cv"].value == pytest.approx(0.0, abs=1e-6)
    assert q["stability.FT3.LQC"].value == pytest.approx(100.0, abs=1e-6)
    assert q["runs.accepted"].value == 7  # 3 A&P + selectivity + matrix + dilution + stability


def test_failing_criteria_are_reported_with_their_m10_section():
    res, _ = _analyze(
        _measured(
            dict(SIM, blank_fraction_of_lloq=0.30, stability_loss_percent={"FT3": 20.0, "BT6": 0.0})
        )
    )
    msgs = [f.message for f in res.qc.findings]
    assert any("Selectivity" in m and "M10 3.2.1" in m for m in msgs)  # 30% > 20% of LLOQ
    assert any("stability FT3" in m and "M10 3.2.8" in m for m in msgs)  # 80% of nominal
    assert not any("stability BT6" in m for m in msgs)


def test_bad_calibrator_is_rejected_and_curve_refitted():
    def spoil(rows):
        for r in rows:
            if r["run_id"] == "AP1" and r["level"] == "CAL4":
                r["analyte_response"] *= 1.5  # +50% at 20 ng/mL
        return rows

    res, _ = _analyze(_measured(edit=spoil))
    cal = res.tables[0]
    ap1 = next(r for r in cal.rows if r[0] == "AP1")
    assert ap1[3] == "7/8" and ap1[4] == "accepted"  # 87.5% >= 75%, refit without CAL4
    assert res.quantities["ap.MQC.between_run_accuracy"].value == pytest.approx(100.0, abs=1e-6)


@pytest.mark.parametrize(
    "change,needle",
    [
        ({"qc_levels": {"LLOQ": 1, "LQC": 4, "MQC": 400, "HQC": 800}}, "three times the LLOQ"),
        ({"qc_levels": {"LLOQ": 1, "LQC": 3, "MQC": 400, "HQC": 700}}, "75% of the ULOQ"),
        ({"calibration_levels": [1, 5, 20, 100, 1000]}, "at least 6 calibration levels"),
        ({"accuracy_precision_runs": 2}, "at least 3 runs"),
        ({"selectivity_sources": 4}, "at least 6 sources"),
        (
            {
                "stability_tests": [
                    {
                        "name": "FT",
                        "kind": "freeze_thaw",
                        "condition": "c",
                        "duration": "d",
                        "cycles": 2,
                    }
                ]
            },
            "at least 3 cycles",
        ),
    ],
)
def test_design_follows_m10(change, needle):
    with pytest.raises(ValidationError) as e:
        D.validate_parameters(dict(PARAMS, **change))
    assert needle in str(e.value)


def test_rare_matrix_justification_allows_fewer_sources():
    D.validate_parameters(
        dict(
            PARAMS,
            selectivity_sources=3,
            matrix_effect_sources=3,
            rare_matrix_justification="CSF from a rare species",
        )
    )


def test_no_scientific_defaults():
    with pytest.raises(ValidationError):
        D.validate_parameters({"glp": True, "analyte": "x"})


def test_validation_conclusion_is_a_signed_human_determination(tmp_path):
    from hos.core.regulatory import Indication, Modality, ProgramContext, Route
    from hos.db.store import Database, FileStore
    from hos.kernel.attestation import PrincipalKind, Role
    from hos.kernel.errors import KernelError, PermissionDenied
    from hos.kernel.kernel import Kernel

    pw = "correct horse battery staple"
    k = Kernel(db=Database(f"sqlite:///{tmp_path / 'b.sqlite3'}"), files=FileStore(tmp_path / "o"))
    a = k.register_principal(
        None, principal_id="a", name="A", kind=PrincipalKind.HUMAN, roles=[Role.ADMIN], password=pw
    )
    sci = k.register_principal(
        a,
        principal_id="s",
        name="Sam",
        kind=PrincipalKind.HUMAN,
        roles=[Role.SCIENTIST, Role.RESPONSIBLE_SCIENTIST],
        password=pw,
    )
    sd = k.register_principal(
        a,
        principal_id="d",
        name="Dana",
        kind=PrincipalKind.HUMAN,
        roles=[Role.STUDY_DIRECTOR],
        password=pw,
    )
    prog = k.create_program(
        sci,
        name="BA",
        context=ProgramContext(
            modality=Modality.SMALL_MOLECULE,
            indication=Indication.CHRONIC_NON_ONCOLOGY,
            route=Route.ORAL,
            intended_clinical_duration_days=365,
            max_trial_duration_days=28,
        ),
    )
    cid = k.register_compound(sci, prog["id"], name="c", smiles="CC(=O)Nc1ccc(O)cc1")["id"]
    sid = k.create_study(
        sci, program_id=prog["id"], compound_id=cid, requirement_id="bioanalytical.validation"
    )["id"]
    k.design_study(sci, sid, PARAMS)
    k.plan_study(sci, sid)
    k.dispatch_study(sci, sid, {"kind": "external_lab", "laboratory": "BA Lab"})
    k.receive_data(sci, sid, _measured(ref=sid))
    k.analyze_study(sci, sid)
    with pytest.raises(KernelError):  # categorical: a number is refused
        k.record_determination(
            sci, sid, key="method_validated", value=1.0, unit=None, rationale="x"
        )
    with pytest.raises(PermissionDenied):  # a study director does not hold this role here
        k.record_determination(
            sd,
            sid,
            key="method_validated",
            value=None,
            unit=None,
            rationale="x",
            category="validated",
        )
    v = k.record_determination(
        sci,
        sid,
        key="method_validated",
        value=None,
        unit=None,
        rationale="all M10 section 3 criteria met",
        category="validated",
    )
    det = v["determinations"][0]
    assert det["category"] == "validated" and det["quantity"] is None
    v = k.report_study(sci, sid)
    assert "Conclusion by Sam" in v["report"]["markdown"] and "validated" in v["report"]["markdown"]
