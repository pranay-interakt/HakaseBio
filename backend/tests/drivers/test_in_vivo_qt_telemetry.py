"""In vivo QT telemetry driver (ICH S7B 3.1.3; E14/S7B Q&A 3)."""

import csv
import io

import numpy as np
import pytest
from pydantic import ValidationError

from hos.core.quantity import Quantity
from hos.core.regulatory import Indication, Modality, ProgramContext, Route, derive_study_set
from hos.drivers.base import CompoundInfo, IngestError
from hos.drivers.conformance import check_driver
from hos.drivers.in_vivo_qt_telemetry import InVivoQTTelemetryDriver

D = InVivoQTTelemetryDriver()
COMPOUND = CompoundInfo(id="cmp-1", name="Test compound", smiles="CC(=O)Nc1ccc(O)cc1")
TIMES = [1, 2, 4, 8]
PARAMS = dict(
    glp=True,
    species="dog",
    strain="beagle",
    sexes=["M"],
    animals=4,
    design="latin_square_crossover",
    washout="7 days (> 5 half-lives)",
    route="oral capsule",
    vehicle="empty capsule",
    dose_levels_mg_per_kg=[3, 10, 30],
    dose_selection_basis="covers 1-10x the high clinical Cmax",
    positive_control=None,
    positive_control_basis="moxifloxacin historical data, same protocol (HCD 2024)",
    telemetry_system="DSI implant, Ponemah 6",
    interval_bin="15-min means",
    baseline="time_matched",
    post_dose_times_h=TIMES,
    qt_correction="individual",
    rr_reference_ms=600,
    correction_justification="drug lowers "
    "heart rate in the DRF; individual correction per E14/S7B Q&A 3.3",
    blood_pressure=True,
    measure_pr_qrs=False,
    concentration_unit="ng/mL",
    minimum_detectable_difference_ms=8,
    sensitivity_basis="HCD 2024 by-time MDD, same protocol",
)
SIM = dict(
    animals=[
        {"qt_intercept_ms": 150, "qt_rr_slope": 0.15},
        {"qt_intercept_ms": 160, "qt_rr_slope": 0.13},
        {"qt_intercept_ms": 145, "qt_rr_slope": 0.16},
        {"qt_intercept_ms": 155, "qt_rr_slope": 0.14},
    ],
    rr_mean_ms=600,
    rr_sd_ms=0,
    qt_noise_sd_ms=0,
    rr_change_by_dose_ms=[0, 30, 80],
    qtc_change_by_dose_ms=[0, 4, 12],
    # the scenario's declared truth for a conscious beagle; the generator has no defaults
    bp_baseline_mmhg=(135.0, 75.0, 95.0),
    bp_change_by_dose_mmhg=[0, 0, -8],
    cmax_by_dose=[200, 700, 2100],
    pk_sample_time_h=2,
)


def _file(params=PARAMS, sim=SIM, edit=None, ref="HOS-CONFORMANCE-1", rr_sd=None):
    """Lab-format file built from declared per-animal QT-RR relationships (test input)."""
    p = D.validate_parameters(params)
    s = D.simulation_parameters_model().model_validate(sim)
    rows, _ = D._simulate_rows(p, COMPOUND, s, np.random.default_rng(0))
    if rr_sd:  # spread RR within animals (needed to fit individual slopes) while keeping QT
        rng = np.random.default_rng(1)  # on each animal's true line
        truth = {f"A{i + 1:02d}": a for i, a in enumerate(sim["animals"])}
        for r in rows:
            shift = float(rng.normal(0, rr_sd))
            a = truth[r["animal_id"]]
            r["rr"] += shift
            r["qt"] += a["qt_rr_slope"] * shift
            r["heart_rate"] = 60000.0 / r["rr"]
    if edit:
        rows = edit(rows)
    t = D.data_template(p)
    buf = io.StringIO()
    buf.write(
        f"# laboratory: CV Lab\n# analyst: C. Vasc\n# run_date: 2026-09-30\n"
        f"# study_reference: {ref}\n"
    )
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(t.header())
    for r in rows:
        w.writerow(["" if r.get(c.name) is None else r[c.name] for c in t.columns])
    return buf.getvalue().encode()


def _run(raw=None, params=PARAMS, inputs=None):
    p = D.validate_parameters(params)
    return D.analyze(D.ingest(raw or _file(params, rr_sd=40), p), p, COMPOUND, inputs), p


def test_conformance_kit_passes():
    sim = dict(SIM, rr_sd_ms=40, qt_noise_sd_ms=3)
    rep = check_driver(
        D,
        compound=COMPOUND,
        parameters=PARAMS,
        simulation_parameters=sim,
        measured_example=_file(rr_sd=40),
    )
    assert rep.passed, rep.summary()


def test_individual_correction_recovers_the_declared_qtc_effect_exactly():
    res, _ = _run()
    q = res.quantities
    # declared: +12 ms QTc at 30 mg/kg on top of an 80 ms RR increase; vehicle-time-matched
    assert q["ddelta.qtc.30 mg/kg.2"].value == pytest.approx(12.0, abs=1e-9)
    assert q["ddelta.qtc.3 mg/kg.4"].value == pytest.approx(0.0, abs=1e-9)
    # uncorrected QT still carries the heart-rate effect (about slope x 80 ms on top of 12 ms;
    # the RR jitter added to the test data moves it, so only its direction is asserted)
    assert q["ddelta.qt.30 mg/kg.2"].value > 12 + 5
    # within each animal the correction leaves no rate dependence; pooled over animals with
    # different QTc levels the vehicle slope is near zero (its CI contains 0), while across all
    # data the drug's QTc effect coincides with its RR increase
    veh = q["independence.vehicle.slope"].uncertainty
    assert veh.lower < 0 < veh.upper
    assert q["independence.all.slope"].value > 0
    assert q["ddelta.map.30 mg/kg.8"].value == pytest.approx(-8.0)


def test_fixed_coefficient_correction_is_flagged_but_allowed():
    params = dict(PARAMS, qt_correction="fridericia", rr_reference_ms=None)
    res, p = _run(params=params)
    st = D.interpret(res, p).statements
    assert any(s.basis == "E14/S7B Q&A 3.3" for s in st)
    # Fridericia does not remove these dogs' linear QT-RR dependence exactly
    assert res.quantities["ddelta.qtc.30 mg/kg.2"].value != pytest.approx(12.0, abs=0.5)


def test_exposure_coverage_against_high_clinical_cmax():
    inputs = {"high_clinical_cmax": Quantity.user_supplied(3000, "ng/mL", actor="t")}
    res, _ = _run(inputs=inputs)
    assert res.quantities["multiple.30"].value == pytest.approx(0.7)
    assert any(f.code == "exposure.coverage" for f in res.qc.findings)
    ok, _ = _run(inputs={"high_clinical_cmax": Quantity.user_supplied(700, "ng/mL", actor="t")})
    assert not any(f.code == "exposure.coverage" for f in ok.qc.findings)


def test_missing_pk_sample_on_pd_day_is_flagged():
    def drop(rows):
        for r in rows:
            if r["animal_id"] == "A01" and r["dose"] == 10:
                r["plasma_concentration"] = None
        return rows

    res, _ = _run(_file(edit=drop, rr_sd=40))
    assert any(f.code == "pk.10 mg/kg" and "Q&A 3.2" in f.message for f in res.qc.findings)


@pytest.mark.parametrize(
    "change,needle",
    [
        (dict(rr_reference_ms=None), "reference RR"),
        (dict(positive_control_basis=None), "positive control"),
        (dict(sensitivity_basis=None), "minimum detectable difference"),
        (dict(species="rat"), "species"),
    ],
)
def test_design_rules(change, needle):
    with pytest.raises(ValidationError, match=needle):
        D.validate_parameters(dict(PARAMS, **change))


def test_crossover_needs_every_treatment_per_animal():
    def drop(rows):
        return [r for r in rows if not (r["animal_id"] == "A02" and r["dose"] == 30)]

    with pytest.raises(IngestError, match="crossover needs every treatment"):
        D.ingest(_file(edit=drop, rr_sd=40), D.validate_parameters(PARAMS))


def test_covers_cardiovascular_part_only_with_blood_pressure():
    ctx = ProgramContext(
        modality=Modality.SMALL_MOLECULE,
        indication=Indication.CHRONIC_NON_ONCOLOGY,
        route=Route.ORAL,
        intended_clinical_duration_days=365,
        max_trial_duration_days=28,
    )
    req = next(r for r in derive_study_set(ctx).requirements if r.id == "safety.core_battery")
    assert D.probe(req, ctx).supported
    with_bp = D.validate_parameters(PARAMS)
    without = D.validate_parameters(dict(PARAMS, blood_pressure=False))
    assert D.components_covered(req.id, with_bp) == ("cardiovascular",)
    assert D.components_covered(req.id, without) == ()
    keys = [d.key for d in D.expert_determinations(without)]
    assert keys == ["qtc_conclusion"]
