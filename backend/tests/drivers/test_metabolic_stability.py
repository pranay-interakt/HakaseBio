"""Metabolic stability driver: conformance kit + known-value recovery through IVIVE."""

import math

import pytest

from hos.core.quantity import Quantity
from hos.core.regulatory import Indication, Modality, ProgramContext, Route, derive_study_set
from hos.drivers.base import CompoundInfo, DataOrigin, IngestError
from hos.drivers.conformance import check_driver
from hos.drivers.metabolic_stability import MetabolicStabilityDriver
from hos.drivers.metabolic_stability.driver import sample_id
from hos.drivers.registry import DriverRegistry, default_registry

D = MetabolicStabilityDriver()
COMPOUND = CompoundInfo(id="cmp-1", name="Test compound", smiles="CC(=O)Oc1ccccc1C(=O)O")

# Design values used in tests are test inputs, stated explicitly here.
PARAMS = dict(
    species=["human", "rat"],
    substrate_concentration_uM=1.0,
    protein_concentration_mg_per_mL=0.5,
    incubation_temperature_C=37.0,
    buffer="100 mM potassium phosphate, pH 7.4",
    cofactor="1 mM NADPH",
    quench="acetonitrile with internal standard",
    analytical_method="LC-MS/MS",
    timepoints_min=[0, 5, 15, 30, 45, 60],
    replicates=2,
    positive_controls=[{"name": "verapamil", "acceptance_clint_low_uL_min_mg": 50,
                        "acceptance_clint_high_uL_min_mg": 400,
                        "acceptance_basis": "test SOP-001 rev 1"}],
    acceptance_min_r2=0.9,
    acceptance_min_depletion_percent=20.0,
    acceptance_basis="test SOP-001 rev 1",
)
SIM = dict(half_life_min={"human": 20.0, "rat": 10.0},
           control_half_life_min={"PC1": {"human": 15.0, "rat": 5.0}},
           minus_nadph_half_life_min=None, t0_response=1.0, analytical_cv=0.0)
FU = {"fu_plasma.human": Quantity.measured(0.1, "dimensionless", source_name="RED"),
      "blood_plasma_ratio.human": Quantity.measured(1.0, "dimensionless", source_name="B:P")}


def _measured_csv(half_lives: dict[str, float], ref: str = "S-1") -> bytes:
    """A measured-format file with exact first-order responses (test input)."""
    p = D.validate_parameters(PARAMS)
    lines = ["# laboratory: Test Lab", "# analyst: A. Analyst", "# run_date: 2026-09-30",
             f"# study_reference: {ref}", "# instrument: LC-MS/MS",
             "sample_id,compound_code,species,cofactor,replicate,time [min],response,blq"]
    for m in D._manifest(p):
        code, sp, cof, t = m["compound_code"], m["species"], m["cofactor"], float(m["time_min"])
        th = half_lives[f"{code}.{sp}.{cof}"]
        y = 1.0 if th is None else math.exp(-math.log(2) / th * t)
        lines.append(f"{m['sample_id']},{code},{sp},{cof},{m['replicate']},{t:g},{y!r},no")
    return ("\n".join(lines) + "\n").encode()


HL = {"TA.human.NADPH": 20.0, "TA.rat.NADPH": 10.0, "TA.human.none": None, "TA.rat.none": None,
      "PC1.human.NADPH": 15.0, "PC1.rat.NADPH": 5.0}


def test_conformance_kit_passes():
    rep = check_driver(D, compound=COMPOUND, parameters=PARAMS, simulation_parameters=SIM,
                       measured_example=_measured_csv(HL, ref="HOS-CONFORMANCE-1"),
                       analysis_inputs=FU)
    assert rep.passed, rep.summary()


def test_known_value_recovery_through_ivive():
    p = D.validate_parameters(PARAMS)
    data = D.ingest(_measured_csv(HL), p, study_reference="S-1")
    assert data.origin is DataOrigin.MEASURED
    res = D.analyze(data, p, COMPOUND, FU)
    q = res.quantities
    k_h = math.log(2) / 20.0
    assert q["human.t_half"].value == pytest.approx(20.0, rel=1e-9)
    assert q["rat.t_half"].value == pytest.approx(10.0, rel=1e-9)
    clint = k_h * 1000 / 0.5                      # Obach 1999: k / [protein]
    assert q["human.clint_app"].value == pytest.approx(clint, rel=1e-9)
    civ = clint * 32.0 * 21.4 / 1000              # Barter 2007 MPPGL; IVIVE liver weight
    assert q["human.clint_in_vivo"].value == pytest.approx(civ, rel=1e-9)
    clh = 20.7 * 0.1 * civ / (20.7 + 0.1 * civ)   # well-stirred, Davies & Morris Qh
    assert q["human.clh"].value == pytest.approx(clh, rel=1e-9)
    assert q["human.eh"].value == pytest.approx(clh / 20.7, rel=1e-9)
    assert q["human.minus_nadph_remaining"].value == pytest.approx(100.0)
    # rat has no fu inputs: CLh is honestly unavailable, CLint is still reported
    assert not q["rat.clh"].is_available and q["rat.clint_app"].is_available
    # positive control 15 min t1/2 -> 92.4 uL/min/mg, inside the stated 50-400 range
    assert q["control.PC1.human.clint_app"].value == pytest.approx(
        math.log(2) / 15 * 1000 / 0.5, rel=1e-9)
    assert res.qc.passed and res.evidence_admissible


def test_positive_control_out_of_range_fails_run():
    p = D.validate_parameters(PARAMS)
    hl = dict(HL, **{"PC1.rat.NADPH": 1.0})       # 1386 uL/min/mg, above 400
    res = D.analyze(D.ingest(_measured_csv(hl), p), p, COMPOUND, FU)
    assert not res.qc.passed
    interp = D.interpret(res, p)
    assert any("Run acceptance failed" in s.statement for s in interp.statements)


def test_unknown_sample_rejected():
    p = D.validate_parameters(PARAMS)
    raw = _measured_csv(HL).decode().replace(sample_id("TA", "human", "NADPH", 1, 5), "BOGUS-1")
    with pytest.raises(IngestError) as e:
        D.ingest(raw.encode(), p)
    assert any("not in the sample manifest" in x for x in e.value.errors)


def test_missing_zero_time_rejected():
    p = D.validate_parameters(PARAMS)
    lines = [ln for ln in _measured_csv(HL).decode().splitlines()
             if not (ln.startswith("TA-HUMAN-N-") and "-T0," in ln)]
    with pytest.raises(IngestError) as e:
        D.ingest(("\n".join(lines) + "\n").encode(), p)
    assert any("no quantifiable 0 min" in x for x in e.value.errors)


def test_wrong_study_reference_rejected():
    p = D.validate_parameters(PARAMS)
    with pytest.raises(IngestError):
        D.ingest(_measured_csv(HL, ref="S-1"), p, study_reference="S-2")


def test_parameters_have_no_scientific_defaults():
    with pytest.raises(Exception):
        D.validate_parameters({"species": ["human"]})


def test_timepoints_must_start_at_zero():
    with pytest.raises(Exception):
        D.validate_parameters(dict(PARAMS, timepoints_min=[5, 15, 30]))


def test_acceptance_range_requires_basis():
    with pytest.raises(Exception):
        D.validate_parameters(dict(PARAMS, positive_controls=[
            {"name": "x", "acceptance_clint_low_uL_min_mg": 1, "acceptance_clint_high_uL_min_mg": 2}]))


def test_registry_matches_requirement_from_study_set():
    ss = derive_study_set(ProgramContext(
        modality=Modality.SMALL_MOLECULE, indication=Indication.CHRONIC_NON_ONCOLOGY,
        route=Route.ORAL, intended_clinical_duration_days=365, max_trial_duration_days=28))
    req = next(r for r in ss.requirements if r.id == "adme.metabolic_stability")
    matches = default_registry().match(req, ss.context)
    assert [d.id for d, _ in matches] == ["metabolic_stability"]
    assert matches[0][1].prefill["species"] == ["human", "rat", "dog"]


def test_registry_refuses_wrong_abi_and_duplicates():
    from hos.kernel.errors import DriverError

    class Old(MetabolicStabilityDriver):
        abi = "0.9"
    reg = DriverRegistry()
    with pytest.raises(DriverError):
        reg.register(Old)

    class Clash(MetabolicStabilityDriver):
        pass
    reg.register(MetabolicStabilityDriver)
    with pytest.raises(DriverError):
        reg.register(Clash)


def test_report_markdown_contains_provenance_and_hash():
    p = D.validate_parameters(PARAMS)
    data = D.ingest(_measured_csv(HL), p)
    res = D.analyze(data, p, COMPOUND, FU)
    proto = D.design(COMPOUND, p)
    rep = D.report(proto, data, res, D.interpret(res, p))
    md = rep.to_markdown()
    assert data.file_sha256 in md and "obach1999" in md and rep.evidence_admissible
