"""Dose range-finding driver (ICH M3(R2) 1.5, 4): incidence, high-dose facts, determinations."""

import csv
import io

import numpy as np
import pytest
from pydantic import ValidationError

from hos.core.quantity import Quantity
from hos.drivers.base import CompoundInfo, IngestError, canonical_hash, tabulate
from hos.drivers.conformance import check_driver
from hos.drivers.dose_range_finding import DoseRangeFindingDriver
from hos.drivers.repeat_dose_tox.analysis import compare_groups

D = DoseRangeFindingDriver()
COMPOUND = CompoundInfo(id="cmp-1", name="Test compound", smiles="CC(=O)Nc1ccc(O)cc1")
PARAMS = dict(
    glp=False,
    species="rat",
    strain="Sprague-Dawley",
    route="oral gavage",
    vehicle="0.5% methylcellulose",
    include_control=True,
    dose_levels_mg_per_kg_day=[100, 300, 1000],
    sexes=["M", "F"],
    animals_per_sex_per_group=3,
    dosing_duration_days=7,
    endpoints=[
        {"name": "body weight", "unit": "g", "category": "body_weight"},
        {"name": "food consumption", "unit": "g", "category": "food_consumption"},
    ],
    timepoints=["day 1", "day 7"],
    statistics="none",
    statistics_basis="n = 3 per sex: descriptive comparison only (protocol section 9)",
    mtd_criteria="body-weight loss or clinical signs that preclude continued dosing, per SOP "
    "TOX-12",
    exposure_metric="AUC",
    concentration_unit="ng/mL",
)
SIM = dict(
    endpoints=[
        {
            "endpoint": "body weight",
            "control_mean": 250.0,
            "cv": 0.0,
            "effect_percent_by_dose": [0, -4, -12],
        },
        {
            "endpoint": "food consumption",
            "control_mean": 20.0,
            "cv": 0.0,
            "effect_percent_by_dose": [0, -10, -30],
        },
    ],
    clinical_signs=[
        {"sign": "piloerection", "from_dose": 300, "fraction": 0.6, "timepoint": "day 2"}
    ],
    deaths=[],
)


def _file(params=PARAMS, sim=SIM, edit=None, ref="HOS-CONFORMANCE-1"):
    """Lab-format file built from declared effects (test input)."""
    p = D.validate_parameters(params)
    s = D.simulation_parameters_model().model_validate(sim)
    rows, _ = D._simulate_rows(p, COMPOUND, s, np.random.default_rng(0))
    if edit:
        rows = edit(rows)
    t = D.data_template(p)
    buf = io.StringIO()
    buf.write(
        f"# laboratory: Tox Lab\n# analyst: T. Tox\n# run_date: 2026-09-30\n"
        f"# study_reference: {ref}\n"
    )
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(t.header())
    for r in rows:
        w.writerow(["" if r.get(c.name) is None else r[c.name] for c in t.columns])
    return buf.getvalue().encode()


def _run(raw=None, params=PARAMS, inputs=None):
    p = D.validate_parameters(params)
    return D.analyze(D.ingest(raw or _file(params), p), p, COMPOUND, inputs), p


def test_conformance_kit_passes():
    sim = dict(SIM, endpoints=[dict(e, cv=0.05) for e in SIM["endpoints"]])
    rep = check_driver(
        D, compound=COMPOUND, parameters=PARAMS, simulation_parameters=sim, measured_example=_file()
    )
    assert rep.passed, rep.summary()


def test_group_comparison_is_the_shared_repeat_dose_analysis():
    res, p = _run()
    q = res.quantities
    assert q["group|body weight|M|main|day 7|1000|pct_vs_control"].value == pytest.approx(-12)
    assert q["group|food consumption|F|main|day 1|300|pct_vs_control"].value == pytest.approx(-10)
    data = D.ingest(_file(), p)
    numeric = [
        dict(r, phase="main")
        for r in data.records
        if r["endpoint"] not in ("clinical_sign", "mortality")
    ]
    ref = compare_groups(
        numeric,
        endpoint_unit=lambda e: p.endpoint(e).unit,
        groups=p.groups(),
        alpha=None,
        prov_note=f"file sha256 {data.file_sha256[:16]}",
    )
    table = next(t for t in res.tables if t.title.startswith("Dose-group comparisons"))
    same = tabulate(table.title, table.columns, ref.rows)  # timestamps are volatile, not content
    assert canonical_hash(table.to_dict()["rows"]) == canonical_hash(same.to_dict()["rows"])


def test_incidence_table_follows_tg407_paragraph_50():
    res, _ = _run()
    inc = next(t for t in res.tables if t.title == "Group incidence")
    by = {(r[0], r[1]): r for r in inc.rows}
    assert by[("300", "M")][2] == 3 and by[("300", "M")][5] == 2  # ceil(0.6 x 3) animals
    assert by[("100", "F")][5] == 0
    signs = next(t for t in res.tables if t.title == "Clinical signs")
    assert ("1000", "F", "piloerection", "2/3") in signs.rows


def test_unscheduled_deaths_are_a_concern_citing_m3r2_section_4():
    sim = dict(
        SIM,
        deaths=[
            {"dose": 1000, "count": 1, "timepoint": "day 7", "description": "euthanised moribund"}
        ],
    )
    res, p = _run(_file(sim=sim))
    assert res.quantities["deaths.unscheduled"].value == 2  # one male, one female
    st = [s for s in D.interpret(res, p).statements if s.basis == "ICH M3(R2) 4"]
    assert st and st[0].severity == "concern"


def test_limit_dose_and_exposure_margin_statements():
    inputs = {
        "animal_exposure_at_top_dose": Quantity.user_supplied(60000, "ng/mL*h", actor="t"),
        "clinical_exposure": Quantity.user_supplied(1000, "ng/mL*h", actor="t"),
    }
    res, p = _run(inputs=inputs)
    assert res.quantities["margin.top_dose"].value == pytest.approx(60.0)
    bases = {s.basis for s in D.interpret(res, p).statements}
    assert "ICH M3(R2) 1.5 limit dose" in bases and "ICH M3(R2) 1.5 50-fold margin" in bases


def test_ten_fold_exception_needs_all_three_conditions():
    low = {
        "animal_exposure_at_top_dose": Quantity.user_supplied(8000, "ng/mL*h", actor="t"),
        "clinical_exposure": Quantity.user_supplied(1000, "ng/mL*h", actor="t"),
    }
    res, p = _run(inputs=low)
    assert "ICH M3(R2) 1.5 exception" not in {s.basis for s in D.interpret(res, p).statements}
    big_dose = {**low, "clinical_dose_per_day": Quantity.user_supplied(1.5, "g/day", actor="t")}
    res, p = _run(inputs=big_dose)
    assert "ICH M3(R2) 1.5 exception" in {s.basis for s in D.interpret(res, p).statements}
    small_dose = {**low, "clinical_dose_per_day": Quantity.user_supplied(500, "mg/day", actor="t")}
    res, p = _run(inputs=small_dose)
    assert "ICH M3(R2) 1.5 exception" not in {s.basis for s in D.interpret(res, p).statements}


def test_dunnett_option_requires_alpha_control_and_replicates():
    with pytest.raises(ValidationError, match="alpha"):
        D.validate_parameters(dict(PARAMS, statistics="dunnett"))
    with pytest.raises(ValidationError, match="concurrent control"):
        D.validate_parameters(dict(PARAMS, statistics="dunnett", alpha=0.05, include_control=False))
    sim = dict(SIM, endpoints=[dict(e, cv=0.05) for e in SIM["endpoints"]])
    params = dict(PARAMS, statistics="dunnett", alpha=0.05)
    res, _ = _run(_file(params, sim), params)
    table = next(t for t in res.tables if "Dunnett" in t.title)
    assert any(isinstance(r[8], Quantity) for r in table.rows)


def test_determinations():
    dets = {d.key: d for d in D.expert_determinations(D.validate_parameters(PARAMS))}
    assert dets["mtd"].unit == "mg/kg/day" and dets["mtd"].required_for_approval
    assert "exposure_margin_50x" in dets["high_dose_basis"].choices
    assert not dets["recommended_low_dose"].required_for_approval
    assert all(d.role.value == "study_director" for d in dets.values())


def test_strict_ingest():
    def bad(rows):
        rows[0]["value"] = None  # numeric endpoint without value
        sign = next(r for r in rows if r["endpoint"] == "clinical_sign")
        sign.update(value=1.0, unit="g")  # observation with a value
        rows[1]["dose"] = 50.0  # not a group
        rows[2]["timepoint"] = "day 3"  # numeric row off the schedule
        return rows

    with pytest.raises(IngestError) as exc:
        D.ingest(_file(edit=bad), D.validate_parameters(PARAMS))
    msg = " ".join(exc.value.errors)
    for text in (
        "needs a value and unit",
        "observation and no value",
        "not a group",
        "not in the protocol",
    ):
        assert text in msg
