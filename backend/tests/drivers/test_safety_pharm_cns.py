"""CNS safety pharmacology driver (ICH S7A 2.7.1)."""

import csv
import io

import numpy as np
import pytest
from pydantic import ValidationError

from hos.core.regulatory import Indication, Modality, ProgramContext, Route, derive_study_set
from hos.drivers.base import CompoundInfo, IngestError
from hos.drivers.conformance import check_driver
from hos.drivers.safety_pharm_cns import SafetyPharmCNSDriver

D = SafetyPharmCNSDriver()
COMPOUND = CompoundInfo(id="cmp-1", name="Test compound", smiles="CC(=O)Nc1ccc(O)cc1")
OBS = [
    {
        "name": "locomotor activity",
        "domain": "motor_activity",
        "scale": "continuous",
        "unit": "1/h",
    },
    {"name": "tremor", "domain": "behaviour", "scale": "binary", "normal_score": 0},
    {
        "name": "gait",
        "domain": "coordination",
        "scale": "ordinal",
        "normal_score": 0,
        "score_min": 0,
        "score_max": 3,
    },
    {
        "name": "pinna reflex",
        "domain": "sensory_motor_reflex",
        "scale": "binary",
        "normal_score": 1,
    },
    {
        "name": "body temperature",
        "domain": "body_temperature",
        "scale": "continuous",
        "unit": "degC",
    },
]
PARAMS = dict(
    glp=True,
    species="rat",
    strain="Sprague-Dawley",
    sexes=["M"],
    route="oral gavage",
    vehicle="0.5% methylcellulose",
    method="fob",
    method_reference="SOP SP-03 (Mattsson 1996)",
    dose_levels_mg_per_kg=[10, 30, 100],
    dose_selection_basis="covers 1-10x the efficacious "
    "dose; top dose 100 mg/kg gave tremor in the DRF",
    animals_per_sex_per_group=6,
    group_size_basis="detects a 1 degC change (SD 0.5) with 80% power",
    positive_control="chlorpromazine 10 mg/kg",
    timepoints=["pre-dose", "1 h", "4 h", "24 h"],
    baseline_timepoint="pre-dose",
    timepoint_basis="Tmax 1 h; t1/2 3 h",
    observations=OBS,
    statistics="none",
    statistics_basis="descriptive per protocol section 10",
)
SIM = dict(
    observations=[
        {
            "observation": "locomotor activity",
            "control_mean": 120.0,
            "sd": 0.0,
            "effect_by_dose": [0, -10, -50],
            "positive_control_effect": -80,
        },
        {
            "observation": "tremor",
            "incidence_by_dose": [0, 0, 0.5],
            "finding_score": 1,
            "positive_control_incidence": 0.0,
        },
        {
            "observation": "gait",
            "incidence_by_dose": [0, 0, 0.34],
            "finding_score": 2,
            "positive_control_incidence": 1.0,
        },
        {"observation": "pinna reflex", "incidence_by_dose": [0, 0, 0], "finding_score": 0},
        {
            "observation": "body temperature",
            "control_mean": 37.5,
            "sd": 0.0,
            "effect_by_dose": [0, 0, -1.2],
            "positive_control_effect": -1.5,
        },
    ]
)


def _file(params=PARAMS, sim=SIM, edit=None, ref="HOS-CONFORMANCE-1"):
    """Lab-format file built from declared incidences and effects (test input)."""
    p = D.validate_parameters(params)
    s = D.simulation_parameters_model().model_validate(sim)
    rows, _ = D._simulate_rows(p, COMPOUND, s, np.random.default_rng(0))
    if edit:
        rows = edit(rows)
    t = D.data_template(p)
    buf = io.StringIO()
    buf.write(
        f"# laboratory: SP Lab\n# analyst: S. Pharm\n# run_date: 2026-09-30\n"
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


def test_conformance_kit_passes():
    sim = dict(observations=[dict(o, sd=1.0) if "sd" in o else o for o in SIM["observations"]])
    rep = check_driver(
        D, compound=COMPOUND, parameters=PARAMS, simulation_parameters=sim, measured_example=_file()
    )
    assert rep.passed, rep.summary()


def test_all_five_s7a_domains_are_required():
    with pytest.raises(ValidationError, match=r"domains not covered.*body_temperature"):
        D.validate_parameters(dict(PARAMS, observations=OBS[:4]))


def test_positive_control_or_justified_omission():
    with pytest.raises(ValidationError, match=r"S7A 2\.3\.3\.1"):
        D.validate_parameters(dict(PARAMS, positive_control=None))
    D.validate_parameters(
        dict(
            PARAMS,
            positive_control=None,
            positive_control_omission_justification="validated FOB in this "
            "strain with historical positive-control data",
        )
    )


def test_incidence_counts_are_exact_and_baseline_is_clean():
    res, _ = _run()
    inc = next(t for t in res.tables if t.title == "Incidence of findings")
    rows = {(r[0], r[2], r[4]): r[5] for r in inc.rows}
    assert rows[("tremor", "100 mg/kg", "1 h")] == "3/6"
    assert rows[("gait", "100 mg/kg", "4 h")] == "3/6"  # ceil(0.34 x 6)
    assert rows[("tremor", "100 mg/kg", "pre-dose")] == "0/6"
    assert rows[("gait", "positive control", "1 h")] == "6/6"
    assert rows[("pinna reflex", "100 mg/kg", "1 h")] == "0/6"  # normal score is 1 (present)


def test_continuous_measures_vs_vehicle():
    res, _ = _run()
    q = res.quantities
    k = "group|body temperature|M|main|1 h|100|pct_vs_control"
    assert q[k].value == pytest.approx(100 * -1.2 / 37.5)
    assert "group|locomotor activity|M|main|1 h|30|pct_vs_control" in q


def test_findings_are_stated_with_s7a_basis_and_conclusion_is_routed():
    res, p = _run()
    st = D.interpret(res, p).statements
    assert any(s.basis == "ICH S7A 2.4.1" and s.severity == "notable" for s in st)
    det = {d.key: d for d in D.expert_determinations(p)}
    assert det["overall_conclusion"].choices == ("no_effect_identified", "effect_identified")
    assert det["overall_conclusion"].role.value == "study_director"


def test_strict_ingest_checks_scores_and_groups():
    def bad(rows):
        g = next(r for r in rows if r["observation"] == "gait")
        g["result"] = 5.0  # outside 0-3
        v = next(r for r in rows if r["group"] == "vehicle")
        v["dose"] = 10.0  # vehicle with a dose
        return rows

    with pytest.raises(IngestError) as exc:
        D.ingest(_file(edit=bad), D.validate_parameters(PARAMS))
    msg = " ".join(exc.value.errors)
    assert "scored 0-3" in msg and "vehicle animals have dose 0" in msg


def test_driver_covers_the_cns_part_of_the_core_battery():
    ctx = ProgramContext(
        modality=Modality.SMALL_MOLECULE,
        indication=Indication.CHRONIC_NON_ONCOLOGY,
        route=Route.ORAL,
        intended_clinical_duration_days=365,
        max_trial_duration_days=28,
    )
    req = next(r for r in derive_study_set(ctx).requirements if r.id == "safety.core_battery")
    assert req.components == ("cns", "cardiovascular", "respiratory")
    assert D.probe(req, ctx).supported and D.components_for(req.id) == ("cns",)
