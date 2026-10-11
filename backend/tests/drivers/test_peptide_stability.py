"""Peptide stability driver (blood, serum or plasma; docs/14 Wave P, P-2)."""

import csv
import io
import math

import numpy as np
import pytest
from pydantic import ValidationError

from hos.core.regulatory import (
    Indication,
    Modality,
    PeptideOrigin,
    ProgramContext,
    Route,
    derive_study_set,
)
from hos.drivers.base import CompoundInfo, IngestError
from hos.drivers.conformance import check_driver
from hos.drivers.peptide_stability import PeptideStabilityDriver
from hos.drivers.registry import default_registry

D = PeptideStabilityDriver()
COMPOUND = CompoundInfo(id="pep-1", name="Test peptide", smiles=None)
SERUM = dict(matrix="serum", serum_clot_activator=False, freshly_collected=False,
             material_source="commercial pooled serum", matrix_percent=25,
             pretreatment="centrifuged to remove lipids, pre-warmed 15 min")
PARAMS = dict(
    glp=False,
    conditions=[dict(id="human-serum", species="human", **SERUM),
                dict(id="rat-serum", species="rat", **SERUM),
                dict(id="rat-edta", species="rat", matrix="plasma", anticoagulant="K2-EDTA",
                     freshly_collected=True, material_source="in-house Sprague-Dawley",
                     matrix_percent=100)],
    peptide_concentration=5, concentration_unit="umol/L", temperature_c=37,
    agitation="thermomixer 750 rpm", sampling_times_min=[0, 30, 75, 120, 240, 390, 540],
    replicates=3, quench="15% TCA, 15 min at 4 °C", quantification="RP-HPLC C18, 215 nm",
    response="peak_area", fit_model="first_order", fit_model_basis="protocol section 9",
    min_r2=0.9, min_depletion_percent=20, acceptance_basis="laboratory SOP PS-04")
SIM = dict(decay=[{"condition": "human-serum", "half_life_min": 120, "plateau_percent": 0},
                  {"condition": "rat-serum", "half_life_min": 60, "plateau_percent": 0},
                  {"condition": "rat-edta", "half_life_min": 5000, "plateau_percent": 0}],
           time_zero_response=12000, proportional_sd_log=0.0, quantitation_limit_percent=0.5)


def _file(params=PARAMS, sim=SIM, edit=None, ref="HOS-CONFORMANCE-1"):
    """Lab-format file built from declared true half-lives (test input)."""
    p = D.validate_parameters(params)
    s = D.simulation_parameters_model().model_validate(sim)
    rows, _ = D._simulate_rows(p, COMPOUND, s, np.random.default_rng(0))
    if edit:
        rows = edit(rows)
    t = D.data_template(p)
    buf = io.StringIO()
    buf.write(f"# laboratory: Peptide Lab\n# analyst: P. Analyst\n# run_date: 2026-09-30\n"
              f"# study_reference: {ref}\n")
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(t.header())
    for r in rows:
        w.writerow(["" if r.get(c.name) is None else r[c.name] for c in t.columns])
    return buf.getvalue().encode()


def _run(raw=None, params=PARAMS):
    p = D.validate_parameters(params)
    return D.analyze(D.ingest(raw or _file(params), p), p, COMPOUND), p


def test_conformance_kit_passes():
    rep = check_driver(D, compound=COMPOUND, parameters=PARAMS,
                       simulation_parameters=dict(SIM, proportional_sd_log=0.05),
                       measured_example=_file())
    assert rep.passed, rep.summary()


def test_half_lives_are_recovered_exactly_and_slow_ones_censored():
    res, _ = _run()
    q = res.quantities
    assert q["t_half.human-serum"].value == pytest.approx(120, rel=1e-9)
    assert q["t_half.rat-serum"].value == pytest.approx(60, rel=1e-9)
    assert not q["t_half.rat-edta"].is_available                      # 5000 min > 540 min
    assert q["remaining_last.rat-edta"].value == pytest.approx(
        100 * math.exp(-math.log(2) / 5000 * 540), rel=1e-9)


def test_samples_below_the_limit_are_excluded_not_zeroed():
    sim = dict(SIM, decay=[dict(d, half_life_min=30) if d["condition"] == "rat-serum" else d
                           for d in SIM["decay"]], quantitation_limit_percent=1.0)
    res, _ = _run(_file(sim=sim))
    assert res.quantities["t_half.rat-serum"].value == pytest.approx(30, rel=1e-9)
    assert any(f.code == "rat-serum.below_limit" for f in res.qc.findings)


def test_the_protocol_states_every_matrix_fact():
    bad = dict(PARAMS, conditions=[dict(PARAMS["conditions"][2], anticoagulant=None)])
    with pytest.raises(ValidationError, match="anticoagulant"):
        D.validate_parameters(bad)
    bad = dict(PARAMS, conditions=[dict(PARAMS["conditions"][0], serum_clot_activator=None)])
    with pytest.raises(ValidationError, match="activator"):
        D.validate_parameters(bad)
    with pytest.raises(ValidationError, match="start at 0"):
        D.validate_parameters(dict(PARAMS, sampling_times_min=[5, 30, 60]))
    with pytest.raises(ValidationError, match="four or more"):
        D.validate_parameters(dict(PARAMS, fit_model="one_phase_decay",
                                   sampling_times_min=[0, 30, 60]))


def test_strict_ingest():
    def bad(rows):
        rows[0]["below_limit"] = "yes"                     # time zero below the limit
        rows[0]["response"] = None
        rows[5]["time_min"] = 45.0                         # not a protocol time
        rows.append(dict(rows[3]))                         # duplicate
        return rows
    with pytest.raises(IngestError) as exc:
        D.ingest(_file(edit=bad), D.validate_parameters(PARAMS))
    msg = " ".join(exc.value.errors)
    for text in ("no quantifiable time-zero", "not a protocol sampling time", "duplicate"):
        assert text in msg


def test_species_are_compared_only_when_nothing_else_differs():
    res, p = _run()
    texts = [s.statement for s in D.interpret(res, p).statements]
    assert any("human-serum and rat-serum differ only in species" in t for t in texts)
    assert not any("rat-edta and" in t and "only in species" in t for t in texts)
    assert any("Böttger" in t for t in texts)


def test_one_phase_model_reports_the_plateau():
    params = dict(PARAMS, fit_model="one_phase_decay")
    sim = dict(SIM, decay=[dict(d, plateau_percent=25) for d in SIM["decay"]])
    res, _ = _run(_file(params, sim), params)
    assert res.quantities["plateau.human-serum"].value == pytest.approx(25, abs=1e-6)
    assert res.quantities["t_half.human-serum"].value == pytest.approx(120, rel=1e-6)
    assert any(f.code == "human-serum.incomplete_degradation" for f in res.qc.findings)


def test_it_serves_metabolic_stability_for_peptides_only():
    reg = default_registry()
    pep = ProgramContext(modality=Modality.PEPTIDE, indication=Indication.CHRONIC_NON_ONCOLOGY,
                         route=Route.SUBCUTANEOUS, intended_clinical_duration_days=365,
                         max_trial_duration_days=28,
                         peptide_origin=PeptideOrigin.CHEMICAL_SYNTHESIS)
    req = next(r for r in derive_study_set(pep).requirements
               if r.id == "adme.metabolic_stability")
    assert req.driver_id == "peptide_stability" and "blood, serum or plasma" in req.name
    assert D.id in [d.id for d, _ in reg.match(req, pep)]
    sm = ProgramContext.from_dict({**pep.to_dict(), "modality": "small_molecule",
                                   "peptide_origin": None})
    req_sm = next(r for r in derive_study_set(sm).requirements
                  if r.id == "adme.metabolic_stability")
    assert D.id not in [d.id for d, _ in reg.match(req_sm, sm)]


def test_a_censored_condition_carries_no_plateau_claim():
    """With ~6% degradation the plateau is trivially above zero; no half-life is reported,
    so nothing is 'hidden' and the check is not raised."""
    res, _ = _run(_file(sim=dict(SIM, proportional_sd_log=0.05)))
    assert not res.quantities["t_half.rat-edta"].is_available
    assert not any(f.code == "rat-edta.incomplete_degradation" for f in res.qc.findings)
