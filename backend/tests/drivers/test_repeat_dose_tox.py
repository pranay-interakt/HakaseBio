"""Repeat-dose toxicity driver: TG design rules, Dunnett 1955 known values, NOAEL boundary."""

import pytest

from hos.core.regulatory import Indication, Modality, ProgramContext, Route, derive_study_set
from hos.drivers.base import CompoundInfo
from hos.drivers.conformance import check_driver
from hos.drivers.registry import default_registry
from hos.drivers.repeat_dose_tox import RepeatDoseToxicityDriver

D = RepeatDoseToxicityDriver()
COMPOUND = CompoundInfo(id="cmp-1", name="Test compound", smiles="CCO")
ENDPOINTS = [
    {"name": "body weight", "unit": "g", "category": "body_weight"},
    {"name": "ALT", "unit": "U/L", "category": "clinical_chemistry",
     "checklist_item": "hepatocellular enzyme (at least two)"},
    {"name": "liver weight", "unit": "g", "category": "organ_weight", "checklist_item": "liver"},
]
PARAMS = dict(glp=True, species="rat", strain="Sprague-Dawley", guideline_basis="oecd_tg407",
              route="oral gavage", vehicle="0.5% methylcellulose",
              dose_levels_mg_per_kg_day=[10, 30, 100], animals_per_sex_per_group=5,
              dosing_duration_days=28, recovery=True, recovery_animals_per_sex=5,
              recovery_duration_days=14, endpoints=ENDPOINTS, timepoints=["day 29"],
              alpha=0.05, statistics_basis="Study Director, protocol section 12")
SIM = {"endpoints": {
    "body weight": {"control_mean": 300.0, "cv": 0.05, "effect_percent_by_dose": [0, -2, -15],
                    "recovery_effect_fraction": 0.2},
    "ALT": {"control_mean": 40.0, "cv": 0.15, "effect_percent_by_dose": [0, 10, 150],
            "recovery_effect_fraction": 0.1},
    "liver weight": {"control_mean": 12.0, "cv": 0.08, "effect_percent_by_dose": [0, 5, 30],
                     "recovery_effect_fraction": 0.3}}}

# Dunnett (1955) worked example (blood counts), as reproduced in the scipy.stats.dunnett docs.
CTRL = [7.40, 8.50, 7.20, 8.24, 9.84, 8.32]
DRUG_A = [9.76, 8.80, 7.68, 9.36]
DRUG_B = [12.80, 9.68, 12.16, 9.20, 10.55]


def _csv(groups, ref="HOS-CONFORMANCE-1", unit="1/pL", endpoint="RBC"):
    lines = ["# laboratory: Tox Lab", "# analyst: T. Path", "# run_date: 2026-09-30",
             f"# study_reference: {ref}",
             "subject_id,sex,dose [mg/kg/day],phase,endpoint,timepoint,unit,value"]
    for dose, vals in groups.items():
        for i, v in enumerate(vals):
            lines.append(f"M{dose:g}-{i},M,{dose!r},main,{endpoint},day 29,{unit},{v!r}")
    return ("\n".join(lines) + "\n").encode()


def _dunnett_params():
    return D.validate_parameters(dict(
        PARAMS, guideline_basis="ich_m3r2", recovery=False, recovery_animals_per_sex=None,
        recovery_duration_days=None,
        endpoints=[{"name": "RBC", "unit": "1/pL", "category": "haematology"}]))


def test_conformance_kit_passes():
    p = D.validate_parameters(PARAMS)
    rep = check_driver(D, compound=COMPOUND, parameters=PARAMS, simulation_parameters=SIM)
    assert rep.passed, rep.summary()


def test_dunnett_1955_example_reproduced():
    p = _dunnett_params()
    # third dose group with a single animal is not testable and must not enter the comparison
    data = D.ingest(_csv({0.0: CTRL, 10.0: DRUG_A, 30.0: DRUG_B, 100.0: [8.0]}), p)
    res = D.analyze(data, p, COMPOUND)
    rows = res.tables[0].rows
    pv = {r[4].value: r[8] for r in rows if hasattr(r[8], "value")}
    assert pv[10.0].value == pytest.approx(0.620, abs=2e-3)   # drug A: not significant
    assert pv[30.0].value == pytest.approx(0.0059, abs=1e-3)  # drug B: significant
    assert [r[9] for r in rows if r[4].value == 100.0] == ["-"]
    # deterministic: same p-values on re-analysis
    from hos.drivers.base import canonical_hash
    assert canonical_hash(D.analyze(data, p, COMPOUND).to_dict()) == canonical_hash(res.to_dict())
    stmts = D.interpret(res, p).statements
    assert len([s for s in stmts if "Statistically significant" in s.statement]) == 1
    assert "dunnett1955" in stmts[0].citation_keys


def test_system_never_decides_noael():
    p = D.validate_parameters(PARAMS)
    dets = D.expert_determinations(p)
    noael = next(d for d in dets if d.key == "noael")
    assert noael.required_for_approval and noael.role.value == "study_director"
    interp = D.interpret(D.analyze(D.ingest(
        D.simulate(p, COMPOUND, SIM, seed=3, study_reference="S").content, p), p, COMPOUND), p)
    assert all("NOAEL" not in s.statement for s in interp.statements)
    assert any("NOAEL" in j for j in interp.requires_expert_judgement)


@pytest.mark.parametrize("change,needle", [
    ({"animals_per_sex_per_group": 3}, "para 17"),
    ({"dosing_duration_days": 21}, "28 days"),
    ({"dose_levels_mg_per_kg_day": [10, 100]}, "para 18"),
    ({"species": "dog"}, "applies to"),
    ({"recovery_duration_days": 7}, "at least 14 days"),
])
def test_tg407_design_minimums_enforced(change, needle):
    with pytest.raises(Exception) as e:
        D.validate_parameters(dict(PARAMS, **change))
    assert needle in str(e.value)


def test_tg408_and_409_minimums():
    with pytest.raises(Exception):
        D.validate_parameters(dict(PARAMS, guideline_basis="oecd_tg408", dosing_duration_days=90,
                                   animals_per_sex_per_group=5))
    D.validate_parameters(dict(PARAMS, guideline_basis="oecd_tg409", species="dog",
                               dosing_duration_days=90, animals_per_sex_per_group=4,
                               recovery_animals_per_sex=4))


def test_endpoint_coverage_against_tg_checklist():
    p = D.validate_parameters(PARAMS)
    cov = D.coverage(p)
    assert "liver" not in cov["organ weights missing"]
    assert "kidneys" in cov["organ weights missing"]
    assert "hepatocellular enzyme (at least two)" not in cov["clinical chemistry missing"]


def test_ingest_rejects_unknown_dose_and_incompatible_unit():
    p = _dunnett_params()
    from hos.drivers.base import IngestError
    with pytest.raises(IngestError):
        D.ingest(_csv({0.0: CTRL, 20.0: DRUG_A}), p)
    with pytest.raises(IngestError):
        D.ingest(_csv({0.0: CTRL, 10.0: DRUG_A}, unit="g"), p)


def test_requirement_prefill_from_m3r2_table1():
    ss = derive_study_set(ProgramContext(
        modality=Modality.SMALL_MOLECULE, indication=Indication.CHRONIC_NON_ONCOLOGY,
        route=Route.ORAL, intended_clinical_duration_days=365, max_trial_duration_days=28))
    req = next(r for r in ss.requirements if r.id == "tox.repeat_dose_rodent")
    (d, s), = default_registry().match(req, ss.context)
    assert s.prefill == {"glp": True, "species": "rat", "dosing_duration_days": 28,
                         "guideline_basis": "oecd_tg407"}
