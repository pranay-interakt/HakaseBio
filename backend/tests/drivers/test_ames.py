"""Ames driver (OECD TG 471; ICH S2(R1)): design conformance, summaries, historical controls."""

import csv
import io

import numpy as np
import pytest
from pydantic import ValidationError

from hos.core.regulatory import Indication, Modality, ProgramContext, Route
from hos.drivers.ames import AmesDriver
from hos.drivers.base import CompoundInfo, IngestError
from hos.drivers.conformance import check_driver

D = AmesDriver()
COMPOUND = CompoundInfo(id="cmp-1", name="Test compound", smiles="CC(=O)Nc1ccc(O)cc1")
STRAINS = ["TA1535", "TA1537", "TA98", "TA100", "WP2 uvrA"]
CONCS = [15.8, 50, 158, 500, 1580, 5000]
SPONT = {"TA1535": 15, "TA1537": 8, "TA98": 25, "TA100": 120, "WP2 uvrA": 30}
PARAMS = dict(
    glp=True,
    guideline="oecd_tg471",
    method="plate_incorporation",
    strains=STRAINS,
    metabolic_activation="phenobarbital/beta-naphthoflavone-induced rat liver S9",
    s9_percent_v_v=10,
    vehicle="DMSO",
    untreated_control=True,
    concentration_unit="ug",
    concentrations=CONCS,
    top_dose_basis="limit_5_mg_per_plate",
    top_dose_justification="soluble and non-cytotoxic in the range-finder",
    plates_per_dose=3,
    incubation_temperature_c=37,
    incubation_hours=48,
    positive_controls=[
        {
            "strain": s,
            "s9": c,
            "substance": "2-aminoanthracene" if c == "plus" else "sodium azide",
            "amount_per_plate": "1 ug",
        }
        for s in STRAINS
        for c in ("plus", "minus")
    ],
    historical_controls=[
        {
            "strain": s,
            "s9": c,
            "control": "negative",
            "mean": SPONT[s],
            "sd": SPONT[s] * 0.2,
            "lower": SPONT[s] * 0.5,
            "upper": SPONT[s] * 1.6,
            "range_type": "95% control limits",
            "reference": "HCD 2021-2025",
        }
        for s in STRAINS
        for c in ("plus", "minus")
    ],
)
FLAT = [1.0] * len(CONCS)
SIM = dict(
    truth=[
        {
            "strain": s,
            "s9": c,
            "vehicle_mean": SPONT[s],
            "positive_mean": SPONT[s] * 10,
            "fold_by_concentration": FLAT,
        }
        for s in STRAINS
        for c in ("plus", "minus")
    ],
    count_model="expected",
)


def _file(params=PARAMS, sim=SIM, edit=None, ref="HOS-CONFORMANCE-1"):
    """Lab-format file built from declared expected counts (test input)."""
    p = D.validate_parameters(params)
    s = D.simulation_parameters_model().model_validate(sim)
    rows, _ = D._simulate_rows(p, COMPOUND, s, np.random.default_rng(0))
    if edit:
        rows = edit(rows)
    t = D.data_template(p)
    buf = io.StringIO()
    buf.write(
        f"# laboratory: Genetox Lab\n# analyst: G. Analyst\n# run_date: 2026-09-30\n"
        f"# study_reference: {ref}\n"
    )
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(t.header())
    for r in rows:
        w.writerow(["" if r.get(c.name) is None else r[c.name] for c in t.columns])
    return buf.getvalue().encode()


def _run(raw=None, params=PARAMS):
    p = D.validate_parameters(params)
    return D.analyze(D.ingest(raw or _file(params), p), p, COMPOUND), p


def _with_fold(strain, s9, folds):
    return dict(
        SIM,
        truth=[
            t
            if not (t["strain"] == strain and t["s9"] == s9)
            else dict(t, fold_by_concentration=folds)
            for t in SIM["truth"]
        ],
    )


def test_conformance_kit_passes():
    rep = check_driver(
        D,
        compound=COMPOUND,
        parameters=PARAMS,
        simulation_parameters=dict(SIM, count_model="poisson"),
        measured_example=_file(),
    )
    assert rep.passed, rep.summary()


def test_means_and_fold_over_vehicle_are_exact():
    folds = [1.0, 1.0, 1.5, 2.0, 3.0, 4.0]
    res, _ = _run(_file(sim=_with_fold("TA98", "plus", folds)))
    q = res.quantities
    assert q["mean.1.TA98.plus.vehicle"].value == 25
    assert q["mean.1.TA98.plus.5000"].value == 100
    assert q["fold.1.TA98.plus.5000"].value == pytest.approx(4.0)
    assert q["fold.1.TA98.plus.158"].value == pytest.approx(1.52)  # round(37.5) = 38 per plate
    assert q["mean.1.TA98.plus.positive"].value == 250
    assert res.qc.passed


def test_means_above_historical_upper_limit_are_reported_not_called():
    res, p = _run(_file(sim=_with_fold("TA98", "plus", [1, 1, 1.5, 2, 3, 4])))
    assert res.quantities["observations.above_historical"].value == 3  # 50, 75, 100 > 40
    interp = D.interpret(res, p)
    assert any(
        "historical negative" in s.statement and s.severity == "notable" for s in interp.statements
    )
    assert any(
        "no fold threshold" in s.statement or "fold threshold" in s.statement
        for s in interp.statements
    )
    (det,) = D.expert_determinations(p)
    assert (
        det.choices == ("positive", "negative", "equivocal") and det.role.value == "study_director"
    )


def test_vehicle_outside_historical_range_is_flagged():
    sim = dict(
        SIM,
        truth=[
            t if not (t["strain"] == "TA100" and t["s9"] == "minus") else dict(t, vehicle_mean=300)
            for t in SIM["truth"]
        ],
    )
    res, _ = _run(_file(sim=sim))
    f = [x for x in res.qc.findings if x.code.startswith("vehicle.historical")]
    assert f and "TG 471 paragraph 14" in f[0].message


@pytest.mark.parametrize(
    "change,needle",
    [
        (dict(strains=STRAINS[:4]), "at least five strains"),
        (dict(strains=["TA1535", "TA1537", "TA98", "TA100", "TA97"]), "recommended combination"),
        (dict(concentrations=CONCS[:4]), "five analysable"),
        (dict(concentrations=[*CONCS[:-1], 10000]), "paragraph 21"),
        (dict(concentrations=[*CONCS[:-1], 2500]), "5 mg/plate limit"),
        (dict(plates_per_dose=2), "triplicate"),
        (dict(untreated_control=False), "paragraph 26"),
        (dict(incubation_hours=96), "48-72 hours"),
        (dict(positive_controls=[]), "List should have at least 1"),
    ],
)
def test_design_rules_cite_tg471(change, needle):
    with pytest.raises(ValidationError, match=needle):
        D.validate_parameters(dict(PARAMS, **change))


def test_missing_positive_control_or_historical_range_is_refused():
    pcs = [pc for pc in PARAMS["positive_controls"] if pc["strain"] != "TA98"]
    with pytest.raises(ValidationError, match="no positive control for TA98"):
        D.validate_parameters(dict(PARAMS, positive_controls=pcs))
    hcs = [h for h in PARAMS["historical_controls"] if h["strain"] != "TA100"]
    with pytest.raises(ValidationError, match="no historical negative-control range for TA100"):
        D.validate_parameters(dict(PARAMS, historical_controls=hcs))


def test_top_dose_basis_needs_supporting_observations():
    params = dict(
        PARAMS,
        top_dose_basis="cytotoxicity",
        concentrations=CONCS[:-1] + [3000],
        top_dose_justification="lawn reduction expected",
    )
    res, _ = _run(_file(params), params)
    assert any(f.code.startswith("topdose.") for f in res.qc.findings)
    res2, _ = _run(_file(params, dict(SIM, lawn_reduced_from=3000)), params)
    assert not any(f.code.startswith("topdose.") for f in res2.qc.findings)


def test_absent_lawn_reduces_analysable_concentrations():
    def clear(rows):
        for r in rows:
            if r["treatment"] == "test" and r["concentration"] >= 1580 and r["strain"] == "TA98":
                r["background_lawn"] = "absent"
        return rows

    res, _ = _run(_file(edit=clear))
    assert any(f.code.startswith("analysable.exp 1 TA98") for f in res.qc.findings)


def test_peptide_programme_gets_the_s2r1_caveat():
    ctx = ProgramContext(
        modality=Modality.PEPTIDE,
        indication=Indication.CHRONIC_NON_ONCOLOGY,
        route=Route.SUBCUTANEOUS,
        intended_clinical_duration_days=365,
        max_trial_duration_days=28,
    )
    p = D.validate_parameters(PARAMS)
    assert "S2(R1) 5.2.1" in " ".join(D.design(COMPOUND, p, ctx).design["design_notes"])
    res, _ = _run()
    assert any("5.2.1" in s.basis for s in D.interpret(res, p, ctx).statements)


def test_strict_ingest():
    def bad(rows):
        rows[0]["concentration"] = 50.0  # a vehicle plate with a concentration
        test = next(r for r in rows if r["treatment"] == "test")
        test["concentration"] = 99.0  # not a protocol concentration
        rows.append(dict(rows[3]))  # duplicate plate
        return rows

    with pytest.raises(IngestError) as exc:
        D.ingest(_file(edit=bad), D.validate_parameters(PARAMS))
    msg = " ".join(exc.value.errors)
    for text in ("no test-article concentration", "protocol concentration", "duplicate plate"):
        assert text in msg
