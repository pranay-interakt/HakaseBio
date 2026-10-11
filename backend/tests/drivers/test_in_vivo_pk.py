"""Single-dose in vivo PK driver: exact one-compartment recovery and the selection workflow."""

import csv
import io
import math

import numpy as np
import pytest
from pydantic import ValidationError

from hos.core.quantity import Quantity
from hos.drivers.base import CompoundInfo, IngestError
from hos.drivers.conformance import check_driver
from hos.drivers.in_vivo_pk import InVivoPKDriver
from hos.drivers.in_vivo_pk.driver import input_name

D = InVivoPKDriver()
COMPOUND = CompoundInfo(id="cmp-1", name="Test compound", smiles="CC(=O)Nc1ccc(O)cc1")
K, C0, DOSE_IV, DOSE_PO = 0.3, 10000.0, 10.0, 20.0  # 1/h, ng/mL, mg/kg, mg/kg
T_IV = [0.25, 0.5, 1, 2, 4, 6, 8, 12]
T_PO = [0.25, 0.5, 1, 2, 4, 6, 8, 12]


def iv(t):  # one-compartment IV bolus: V = Dose/C0 = 1 L/kg, CL = k V
    return C0 * math.exp(-K * t)


def po(t):  # linear rise to 5000 ng/mL at 1 h, then mono-exponential decline
    return 5000.0 * t if t <= 1 else 5000.0 * math.exp(-K * (t - 1))


PARAMS = dict(
    glp=False, species="rat", strain="Sprague-Dawley", analyte="test compound", matrix="plasma",
    bioanalytical_technique="chromatographic", bioanalytical_method_reference="BMV-001",
    concentration_unit="ng/mL", lloq=1.0, dose_unit="mg/kg",
    groups=[dict(group_id="IV", administration="iv_bolus", route="intravenous", dose=DOSE_IV,
                 formulation="solution in saline", sex="M", animals=3, sampling_times_h=T_IV),
            dict(group_id="PO", administration="extravascular", route="oral gavage", dose=DOSE_PO,
                 formulation="suspension in 0.5% MC", sex="M", animals=3, sampling_times_h=T_PO)],
    crossover=False, dose_time_rule="zero_single_dose", auc_method="linear_up_log_down",
    auc_method_basis="PK SOP-3", blq_rule="leading_zero_then_excluded",
    auc_inf_basis="observed_clast")
SIM = dict(profiles=[{"group_id": "IV", "concentrations": [iv(t) for t in T_IV]},
                     {"group_id": "PO", "concentrations": [po(t) for t in T_PO]}],
           between_animal_sd_log=0.0, residual_sd_log=0.0)


def _file(params=PARAMS, sim=SIM, edit=None, ref="HOS-CONFORMANCE-1"):
    """Lab-format file built from declared profiles (test input)."""
    p = D.validate_parameters(params)
    s = D.simulation_parameters_model().model_validate(sim)
    rows, _ = D._simulate_rows(p, COMPOUND, s, np.random.default_rng(0))
    if edit:
        rows = edit(rows)
    t = D.data_template(p)
    buf = io.StringIO()
    buf.write(f"# laboratory: PK Lab\n# analyst: P. Analyst\n# run_date: 2026-09-30\n"
              f"# study_reference: {ref}\n")
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(t.header())
    for r in rows:
        w.writerow(["" if r.get(c.name) is None else r[c.name] for c in t.columns])
    return buf.getvalue().encode()


def _select(data, params=PARAMS, start=2.0, kind="user"):
    p = D.validate_parameters(params)
    names = D.post_data_inputs(p, data)
    if kind == "user":
        return {n: Quantity.user_supplied(start, "h", actor="sci") for n in names}
    return {n: Quantity.literature(start, "h", source_name="a paper", label=n) for n in names}


def _run(raw=None, inputs=None, params=PARAMS):
    p = D.validate_parameters(params)
    data = D.ingest(raw or _file(params), p)
    return D.analyze(data, p, COMPOUND, inputs if inputs is not None else _select(data, params)), p


def test_conformance_kit_passes():
    rep = check_driver(D, compound=COMPOUND, parameters=PARAMS,
                       simulation_parameters=dict(SIM, between_animal_sd_log=0.2,
                                                  residual_sd_log=0.05),
                       measured_example=_file())
    assert rep.passed, rep.summary()


def test_one_compartment_iv_bolus_is_recovered_exactly():
    res, _ = _run()
    q = res.quantities
    assert q["mean.half_life.IV"].value == pytest.approx(math.log(2) / K, rel=1e-10)
    assert q["mean.auc_inf.IV"].value == pytest.approx(C0 / K, rel=1e-10)
    assert q["mean.cl.IV"].magnitude_in("L/h/kg") == pytest.approx(K * 1.0, rel=1e-10)
    assert q["mean.vss.IV"].magnitude_in("L/kg") == pytest.approx(1.0, rel=1e-10)
    assert q["mean.vz.IV"].magnitude_in("L/kg") == pytest.approx(1.0, rel=1e-10)
    ind = next(t for t in res.tables if t.title == "Individual pharmacokinetic parameters")
    c0 = ind.rows[0][3]
    assert c0.value == pytest.approx(C0, rel=1e-10)  # back-extrapolated from 0.25 and 0.5 h


def test_absolute_bioavailability_from_constructed_profiles():
    res, _ = _run()
    auc_po = 2500.0 + 5000.0 / K  # linear rise to 1 h, then exponential to infinity
    auc_iv = C0 / K
    assert res.quantities["mean.auc_inf.PO"].value == pytest.approx(auc_po, rel=1e-10)
    f = res.quantities["F.PO.IV"]
    assert f.value == pytest.approx(auc_po * DOSE_IV / (auc_iv * DOSE_PO), rel=1e-10)
    assert "assumes linear PK" in f.provenance.notes
    assert res.quantities["mean.cl.PO"].magnitude_in("L/h/kg") == pytest.approx(
        DOSE_PO / auc_po * 1000, rel=1e-10)
    assert "mean.vss.PO" not in res.quantities  # Vss only after intravenous dosing


def test_without_selection_terminal_parameters_are_unavailable():
    res, p = _run(inputs={})
    q = res.quantities
    assert q["profiles.selected"].value == 0
    assert "mean.half_life.IV" not in q and "F.PO.IV" not in q
    ind = next(t for t in res.tables if t.title == "Individual pharmacokinetic parameters")
    assert "not selected" in ind.rows[0][6].provenance.reason
    cand = next(t for t in res.tables if t.title == "Terminal-phase candidates")
    assert any("vendor best fit" in str(r[-1]) for r in cand.rows)
    assert not any("SELECTED" in str(r[-1]) for r in cand.rows)
    assert any(f.code == "terminal.unselected" for f in res.qc.findings)
    assert D.interpret(res, p).statements


def test_selection_must_be_a_user_supplied_input():
    p = D.validate_parameters(PARAMS)
    data = D.ingest(_file(), p)
    res = D.analyze(data, p, COMPOUND, _select(data, kind="literature"))
    assert res.quantities["profiles.selected"].value == 0
    assert any(f.code.startswith("selection.kind") for f in res.qc.findings)


def test_selection_with_too_few_points_is_refused():
    p = D.validate_parameters(PARAMS)
    data = D.ingest(_file(), p)
    res = D.analyze(data, p, COMPOUND, _select(data, start=8.0))  # only 8 and 12 h
    ind = next(t for t in res.tables if t.title == "Individual pharmacokinetic parameters")
    assert "at least 3 declining points" in ind.rows[0][5].provenance.reason


def test_extravascular_selection_through_tmax_is_flagged():
    p = D.validate_parameters(PARAMS)
    data = D.ingest(_file(), p)
    res = D.analyze(data, p, COMPOUND, _select(data, start=1.0))
    assert any(f.code.startswith("terminal.tmax.PO") for f in res.qc.findings)


def test_declared_limits_need_a_basis_and_are_checked():
    with pytest.raises(ValidationError, match="basis"):
        D.validate_parameters(dict(PARAMS, max_extrapolated_percent=20))
    params = dict(PARAMS, max_extrapolated_percent=0.5, min_adjusted_r2=0.9,
                  acceptance_basis="sponsor PK SOP-3 section 5")
    res, _ = _run(params=params)
    assert any(f.code.startswith("extrap.") for f in res.qc.findings)


def test_iv_bolus_c0_unavailable_when_first_points_rise():
    def rising(rows):
        for r in rows:
            if r["group_id"] == "IV" and r["nominal_time"] == 0.25:
                r["concentration"] = iv(0.5) / 2
        return rows
    res, _ = _run(raw=_file(edit=rising))
    ind = next(t for t in res.tables if t.title == "Individual pharmacokinetic parameters")
    row = next(r for r in ind.rows if r[0].startswith("IV/"))
    assert not row[4].is_available and "back-extrapolated" in row[4].provenance.reason


def test_post_data_inputs_name_every_profile():
    p = D.validate_parameters(PARAMS)
    names = set(D.post_data_inputs(p, D.ingest(_file(), p)))
    assert input_name("IV", "M101") in names and len(names) == 6


def test_strict_ingest():
    def bad(rows):
        rows[1].update(concentration=0.5, blq="no")
        rows.append(dict(rows[2]))
        return rows
    with pytest.raises(IngestError) as exc:
        D.ingest(_file(edit=bad), D.validate_parameters(PARAMS))
    msg = " ".join(exc.value.errors)
    assert "below the LLOQ" in msg and "duplicate sample" in msg


def test_parallel_design_rejects_an_animal_in_two_groups():
    def reuse(rows):
        for r in rows:
            if r["group_id"] == "PO" and r["subject_id"] == "M201":
                r["subject_id"] = "M101"
        return rows
    with pytest.raises(IngestError, match="parallel"):
        D.ingest(_file(edit=reuse), D.validate_parameters(PARAMS))


def test_determination_is_categorical_and_signed_by_the_responsible_scientist():
    (d,) = D.expert_determinations(D.validate_parameters(PARAMS))
    assert d.key == "terminal_phase_selection" and d.choices == ("accepted", "not_accepted")
    assert d.role.value == "responsible_scientist" and d.required_for_approval
