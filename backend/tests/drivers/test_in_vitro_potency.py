"""In vitro potency driver: 4PL recovery, relative potency (Ritz 2015), reference compounds."""

import csv
import io
import math

import numpy as np
import pytest
from pydantic import ValidationError

from hos.core.pharmacology import four_parameter_logistic
from hos.core.provenance import Uncertainty
from hos.core.quantity import Quantity
from hos.drivers.base import CompoundInfo, IngestError
from hos.drivers.conformance import check_driver
from hos.drivers.in_vitro_potency import InVitroPotencyDriver
from hos.drivers.in_vitro_potency.driver import relative_potency

D = InVitroPotencyDriver()
COMPOUND = CompoundInfo(id="cmp-1", name="Test compound", smiles="CC(=O)Nc1ccc(O)cc1")
CONCS = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30]
PARAMS = dict(
    glp=False, concentration_unit="uM", min_r2=0.9, fit_acceptance_basis="assay SOP PH-4",
    assays=[
        dict(assay_id="KIN1", target="kinase X (human)", role="primary", assay_format="enzyme "
             "activity", species="human", conditions="ATP at Km (10 uM), 60 min",
             readout="percent_inhibition", asymptotes="fixed_0_100", concentrations=CONCS,
             replicates=2, reference=dict(name="staurosporine", acceptance_low=0.001,
                                          acceptance_high=0.01, basis="lab historical range")),
        dict(assay_id="KIN2", target="kinase Y (human)", role="off_target",
             assay_format="enzyme activity", species="human", conditions="ATP at Km (25 uM), "
             "60 min", readout="percent_inhibition", asymptotes="fixed_0_100",
             concentrations=CONCS, replicates=2)])
SIM = dict(curves=[{"assay_id": "KIN1", "compound": "TEST", "ic50": 0.05, "hill": 1.0,
                    "noise_sd": 0.0},
                   {"assay_id": "KIN1", "compound": "staurosporine", "ic50": 0.004, "hill": 1.0,
                    "noise_sd": 0.0},
                   {"assay_id": "KIN2", "compound": "TEST", "ic50": 2.0, "hill": 1.2,
                    "noise_sd": 0.0}])


def _file(params=PARAMS, sim=SIM, ref="HOS-CONFORMANCE-1"):
    """Lab-format file built from declared 4PL curves (test input)."""
    p = D.validate_parameters(params)
    s = D.simulation_parameters_model().model_validate(sim)
    rows, _ = D._simulate_rows(p, COMPOUND, s, np.random.default_rng(0))
    t = D.data_template(p)
    buf = io.StringIO()
    buf.write(f"# laboratory: Pharm Lab\n# analyst: P. Pharm\n# run_date: 2026-09-30\n"
              f"# study_reference: {ref}\n")
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(t.header())
    for r in rows:
        w.writerow([r[c.name] for c in t.columns])
    return buf.getvalue().encode()


def _run(raw=None, params=PARAMS):
    p = D.validate_parameters(params)
    return D.analyze(D.ingest(raw or _file(params), p), p, COMPOUND), p


def _curve(aid, comp, **kw):
    return dict(SIM, curves=[dict(c, **kw) if (c["assay_id"], c["compound"]) == (aid, comp)
                             else c for c in SIM["curves"]])


def test_conformance_kit_passes():
    sim = dict(curves=[dict(c, noise_sd=2.0) for c in SIM["curves"]])
    rep = check_driver(D, compound=COMPOUND, parameters=PARAMS, simulation_parameters=sim,
                       measured_example=_file())
    assert rep.passed, rep.summary()


@pytest.mark.parametrize("b_", [1.3, -1.3])
def test_ritz_eq2_is_the_implemented_4pl_with_b_equal_hill(b_):
    # Ritz et al. 2015 Eq (2): f = c + (d - c) / (1 + exp(b (log x - log e)));
    # the implemented form is bottom + (top - bottom) / (1 + (C / IC50) ** hill)
    x = np.asarray(CONCS)
    c_, d_, e_ = 5.0, 95.0, 0.2
    ritz = c_ + (d_ - c_) / (1 + np.exp(b_ * (np.log(x) - np.log(e_))))
    ours = four_parameter_logistic(x, bottom=c_, top=d_, ic50=e_, hill=b_)
    assert np.allclose(ritz, ours, rtol=1e-12)


def test_noise_free_potency_and_relative_potency_are_recovered():
    res, _ = _run()
    q = res.quantities
    assert q["potency.KIN1.TEST"].value == pytest.approx(0.05, rel=1e-5)
    assert q["potency.KIN2.TEST"].value == pytest.approx(2.0, rel=1e-5)
    assert q["hill.KIN2.TEST"].value == pytest.approx(1.2, rel=1e-5)
    assert q["relative_potency.KIN2.KIN1"].value == pytest.approx(40.0, rel=1e-5)
    assert res.qc.passed


def test_delta_method_standard_error_of_a_ratio():
    off = Quantity.user_supplied(100.0, "uM", actor="t", uncertainty=Uncertainty("sd", sd=10.0))
    on = Quantity.user_supplied(10.0, "uM", actor="t", uncertainty=Uncertainty("sd", sd=1.0))
    r = relative_potency(off, on)
    se = 10.0 * math.sqrt(0.1 ** 2 + 0.1 ** 2)
    assert r.value == pytest.approx(10.0) and r.uncertainty.sd == pytest.approx(se)
    assert r.uncertainty.lower == pytest.approx(10 - 1.96 * se)


def test_reference_outside_acceptance_invalidates_the_run_and_the_ratio():
    res, p = _run(_file(sim=_curve("KIN1", "staurosporine", ic50=0.05)))
    assert any(f.code == "reference.KIN1" and f.status.value == "fail" for f in res.qc.findings)
    assert "relative_potency.KIN2.KIN1" not in res.quantities
    rp = next(t for t in res.tables if t.title.startswith("Relative potency"))
    assert "reference-compound" in rp.rows[0][2].provenance.reason
    assert any(s.severity == "concern" for s in D.interpret(res, p).statements)


def test_inactive_off_target_gives_a_lower_bound_not_a_number():
    res, _ = _run(_file(sim=_curve("KIN2", "TEST", ic50=3000.0)))
    rp = next(t for t in res.tables if t.title.startswith("Relative potency"))
    reason = rp.rows[0][2].provenance.reason
    assert "above the top concentration" in reason and "relative potency > 600" in reason


def test_percent_activity_readout_reports_ec50():
    params = dict(PARAMS, assays=[dict(PARAMS["assays"][0], readout="percent_activity",
                                       reference=None)])
    sim = dict(curves=[dict(SIM["curves"][0])])
    res, _ = _run(_file(params, sim), params)
    assert res.quantities["potency.KIN1.TEST"].value == pytest.approx(0.05, rel=1e-5)
    assert "EC50" in res.quantities["potency.KIN1.TEST"].label


def test_design_rules_and_strict_ingest():
    with pytest.raises(ValidationError, match="primary-target assay"):
        D.validate_parameters(dict(PARAMS, assays=[PARAMS["assays"][1]]))
    raw = _file().replace(b"KIN2,TEST", b"KIN2,staurosporine", 1)
    with pytest.raises(IngestError, match="not the reference compound"):
        D.ingest(raw, D.validate_parameters(PARAMS))


def test_different_assay_conditions_are_noted_in_the_protocol():
    proto = D.design(COMPOUND, D.validate_parameters(PARAMS))
    assert "not affinity ratios" in " ".join(proto.design["design_notes"])
