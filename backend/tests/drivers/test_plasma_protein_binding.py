"""Plasma protein binding driver (equilibrium dialysis; ICH M12 7.2 positive-control rule)."""

import csv
import io

import numpy as np
import pytest
from pydantic import ValidationError

from hos.core.descriptors import compute_profile
from hos.drivers.base import CompoundInfo, IngestError
from hos.drivers.conformance import check_driver
from hos.drivers.plasma_protein_binding import PlasmaProteinBindingDriver

D = PlasmaProteinBindingDriver()
COMPOUND = CompoundInfo(id="cmp-1", name="Test compound", smiles="CC(=O)Nc1ccc(O)cc1")
PARAMS = dict(
    glp=False, method="equilibrium_dialysis", device="RED device inserts (MWCO 8 kDa)",
    membrane_mwco_da=8000, matrices={"human": "plasma (K2EDTA)", "rat": "plasma (K2EDTA)"},
    test_concentrations=[1000, 10000], concentration_unit="ng/mL", lloq=1.0,
    incubation_time_h=4, temperature_c=37, agitation="orbital shaking 250 rpm",
    atmosphere="5% CO2", equilibrium_basis="time course to 6 h, report PPB-QUAL-02",
    plasma_volume_ul=200, buffer_volume_ul=350, buffer="PBS pH 7.4", replicates=3,
    bioanalytical_method_reference="LCMS-PPB-1",
    positive_controls=[{"name": "warfarin", "species": "human", "qualified_mean_fu": 0.012,
                        "qualification_reference": "PPB-QUAL-01"},
                       {"name": "warfarin_rat", "species": "rat", "qualified_mean_fu": 0.03,
                        "qualification_reference": "PPB-QUAL-01"}])
SIM = dict(fu=[{"compound": "TEST", "species": "human", "fu": 0.05},
               {"compound": "TEST", "species": "rat", "fu": 0.12},
               {"compound": "warfarin", "species": "human", "fu": 0.012},
               {"compound": "warfarin_rat", "species": "rat", "fu": 0.03}],
           plasma_fraction_of_nominal=0.9, analytical_sd_log=0.0)


def _file(params=PARAMS, sim=SIM, edit=None, ref="HOS-CONFORMANCE-1"):
    """Lab-format file built from declared true fu values (test input)."""
    p = D.validate_parameters(params)
    s = D.simulation_parameters_model().model_validate(sim)
    rows, _ = D._simulate_rows(p, COMPOUND, s, np.random.default_rng(0))
    if edit:
        rows = edit(rows)
    t = D.data_template(p)
    buf = io.StringIO()
    buf.write(f"# laboratory: DMPK Lab\n# analyst: D. Analyst\n# run_date: 2026-09-30\n"
              f"# study_reference: {ref}\n")
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(t.header())
    for r in rows:
        w.writerow(["" if r.get(c.name) is None else r[c.name] for c in t.columns])
    return buf.getvalue().encode()


def _run(raw=None, params=PARAMS):
    p = D.validate_parameters(params)
    return D.analyze(D.ingest(raw or _file(params), p), p, COMPOUND), p


def _with_fu(name, species, fu):
    return dict(SIM, fu=[f if not (f["compound"] == name and f["species"] == species)
                         else dict(f, fu=fu) for f in SIM["fu"]])


def test_conformance_kit_passes():
    rep = check_driver(D, compound=COMPOUND, parameters=PARAMS,
                       simulation_parameters=dict(SIM, analytical_sd_log=0.05),
                       measured_example=_file())
    assert rep.passed, rep.summary()


def test_fu_is_buffer_over_plasma_exactly():
    res, _ = _run()
    q = res.quantities
    assert q["fu.TEST.human.1000"].value == pytest.approx(0.05, rel=1e-12)
    assert q["fu.TEST.rat.10000"].value == pytest.approx(0.12, rel=1e-12)
    assert res.qc.passed


def test_positive_control_three_fold_boundary_per_ich_m12():
    # exactly 3-fold of the qualified mean passes; beyond it fails
    ok, _ = _run(_file(sim=_with_fu("warfarin", "human", 0.036)))
    assert not [f for f in ok.qc.findings if f.code.startswith("pc.warfarin.")]
    bad, p = _run(_file(sim=_with_fu("warfarin", "human", 0.0372)))
    fail = [f for f in bad.qc.findings if f.code == "pc.warfarin.human"]
    assert fail and "ICH M12 7.2" in fail[0].message and not bad.qc.passed
    low, _ = _run(_file(sim=_with_fu("warfarin", "human", 0.012 / 3.1)))
    assert [f for f in low.qc.findings if f.code == "pc.warfarin.human"]
    assert any(s.severity == "concern" for s in D.interpret(bad, p).statements)


def test_fu_below_one_percent_is_flagged_not_replaced():
    res, p = _run(_file(sim=_with_fu("TEST", "human", 0.004)))
    assert res.quantities["fu.TEST.human.1000"].value == pytest.approx(0.004, rel=1e-12)
    assert [f for f in res.qc.findings if f.code == "fu.below_1_percent"]
    assert any("ICH M12 2.1.2.1" in s.basis for s in D.interpret(res, p).statements)


def test_blq_buffer_gives_an_upper_bound_only():
    res, _ = _run(_file(sim=_with_fu("TEST", "human", 0.0005)))  # buffer 0.45 < LLOQ at 1000
    f = next(f for f in res.qc.findings if f.code == "blq.TEST.human.1000")
    assert "fu < " in f.message
    assert not res.quantities.get("fu.TEST.human.1000")


def test_missing_positive_control_is_warned():
    params = dict(PARAMS, positive_controls=PARAMS["positive_controls"][:1])
    sim = dict(SIM, fu=SIM["fu"][:3])
    res, _ = _run(_file(params, sim), params)
    assert [f for f in res.qc.findings if f.code == "pc.absent.rat"]


def test_laboratory_recovery_checked_against_stated_criterion():
    params = dict(PARAMS, recovery_criterion_percent=70, qc_criteria_basis="lab SOP PPB-07")

    def recovery(rows):
        for r in rows:
            r["recovery_percent"] = 55.0 if r["species"] == "rat" else 90.0
        return rows
    res, p = _run(_file(params, edit=recovery), params)
    assert [f for f in res.qc.findings if f.code.startswith("recovery_percent.TEST.rat")]
    assert any("di2012" in s.citation_keys for s in D.interpret(res, p).statements)
    with pytest.raises(ValidationError, match="basis"):
        D.validate_parameters(dict(PARAMS, recovery_criterion_percent=70))


def test_strict_ingest():
    def bad(rows):
        rows[0].update(buffer_chamber=0.5)            # below the LLOQ, reported quantified
        rows[1].update(nominal_concentration=500)     # not a protocol concentration
        rows.append(dict(rows[2]))                    # duplicate cell
        return rows
    with pytest.raises(IngestError) as exc:
        D.ingest(_file(edit=bad), D.validate_parameters(PARAMS))
    msg = " ".join(exc.value.errors)
    for text in ("below the LLOQ", "not a protocol test concentration", "duplicate cell"):
        assert text in msg


def test_molecule_larger_than_the_membrane_cutoff_is_noted():
    prof = compute_profile(COMPOUND.smiles)
    small = CompoundInfo(id="c", name="c", smiles=COMPOUND.smiles,
                         molecular_weight=prof.molecular_weight)
    proto = D.design(small, D.validate_parameters(dict(PARAMS, membrane_mwco_da=100)))
    assert any("MWCO" in n for n in proto.design["design_notes"])


def test_optional_determination_for_fu_below_one_percent():
    (d,) = D.expert_determinations(D.validate_parameters(PARAMS))
    assert d.choices == ("demonstrated", "not_demonstrated") and not d.required_for_approval
