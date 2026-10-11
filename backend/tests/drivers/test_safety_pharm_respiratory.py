"""Respiratory safety pharmacology driver (ICH S7A 2.7.3)."""

import csv
import io

import numpy as np
import pytest
from pydantic import ValidationError

from hos.drivers.base import CompoundInfo, IngestError
from hos.drivers.conformance import check_driver
from hos.drivers.safety_pharm_respiratory import SafetyPharmRespiratoryDriver

D = SafetyPharmRespiratoryDriver()
COMPOUND = CompoundInfo(id="cmp-1", name="Test compound", smiles="CC(=O)Nc1ccc(O)cc1")
PARAMS = dict(
    glp=True, species="rat", strain="Sprague-Dawley", sexes=["M"], route="oral gavage",
    vehicle="0.5% methylcellulose", method="whole_body_plethysmography",
    acquisition_system="Buxco FinePointe WBP, software-applied temperature/humidity correction",
    measure_tidal_volume=True, tidal_volume_unit="mL", measure_spo2=False,
    dose_levels_mg_per_kg=[10, 30, 100], dose_selection_basis="1-10x the efficacious dose",
    animals_per_sex_per_group=6, group_size_basis="historical CV of rate 12%",
    positive_control="baclofen 10 mg/kg", timepoints=["pre-dose", "0.5 h", "2 h", "6 h"],
    timepoint_basis="Tmax 1 h", statistics="none", statistics_basis="descriptive (protocol 9)")
SIM = dict(measures={
    "respiratory_rate": {"vehicle_mean": 150.0, "sd": 0.0, "effect_by_dose": [0, -15, -45],
                         "positive_control_effect": -60},
    "tidal_volume": {"vehicle_mean": 1.6, "sd": 0.0, "effect_by_dose": [0, 0, 0.2],
                     "positive_control_effect": 0.1}},
    effect_timepoints=["0.5 h", "2 h"])


def _file(params=PARAMS, sim=SIM, edit=None, ref="HOS-CONFORMANCE-1"):
    """Lab-format file built from declared group means and effects (test input)."""
    p = D.validate_parameters(params)
    s = D.simulation_parameters_model().model_validate(sim)
    rows, _ = D._simulate_rows(p, COMPOUND, s, np.random.default_rng(0))
    if edit:
        rows = edit(rows)
    t = D.data_template(p)
    buf = io.StringIO()
    buf.write(f"# laboratory: SP Lab\n# analyst: S. Pharm\n# run_date: 2026-09-30\n"
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
    sim = dict(SIM, measures={k: dict(v, sd=v["vehicle_mean"] * 0.08)
                              for k, v in SIM["measures"].items()})
    rep = check_driver(D, compound=COMPOUND, parameters=PARAMS, simulation_parameters=sim,
                       measured_example=_file())
    assert rep.passed, rep.summary()


def test_s7a_requires_rate_and_another_measure():
    with pytest.raises(ValidationError, match="other measures of respiratory function"):
        D.validate_parameters(dict(PARAMS, measure_tidal_volume=False, tidal_volume_unit=None))
    D.validate_parameters(dict(PARAMS, measure_tidal_volume=False, tidal_volume_unit=None,
                               measure_spo2=True, method="pulse_oximetry"))


def test_time_matched_comparison_and_minute_volume_are_exact():
    res, _ = _run()
    q = res.quantities
    assert q["group|respiratory rate|M|main|2 h|100|pct_vs_control"].value == pytest.approx(-30.0)
    assert q["group|respiratory rate|M|main|6 h|100|pct_vs_control"].value == pytest.approx(0.0)
    # minute volume = VT x f: vehicle 1.6 x 150 = 240; 100 mg/kg at 2 h 1.8 x 105 = 189
    assert q["mv|100 mg/kg|M|2 h|pct_vs_vehicle"].value == pytest.approx(100 * (189 - 240) / 240)
    mv = next(t for t in res.tables if t.title.startswith("Minute volume"))
    assert any(r[0] == "0 mg/kg" and r[2] == "2 h" and r[3].value == pytest.approx(240.0)
               for r in mv.rows)


def test_positive_control_is_reported_separately():
    res, _ = _run()
    pc = next(t for t in res.tables if t.title == "Positive control")
    assert ("respiratory rate", "2 h") in {(r[0], r[1]) for r in pc.rows}
    rate = next(r for r in pc.rows if r[0] == "respiratory rate" and r[1] == "2 h")
    assert rate[2].value == pytest.approx(90.0)


def test_dunnett_option_flags_significant_changes():
    sim = dict(SIM, measures={k: dict(v, sd=v["vehicle_mean"] * 0.05)
                              for k, v in SIM["measures"].items()})
    params = dict(PARAMS, statistics="dunnett", alpha=0.05)
    res, p = _run(_file(params, sim), params)
    assert any(k.endswith("|p") and "respiratory rate" in k and "|100" in k
               for k in res.quantities)
    assert any(s.basis.startswith("Dunnett") for s in D.interpret(res, p).statements)


def test_strict_ingest():
    def bad(rows):
        rows[0]["dose"] = 5.0                     # vehicle with a dose
        rows.append(dict(rows[1]))                # duplicate animal x timepoint
        return rows
    with pytest.raises(IngestError) as exc:
        D.ingest(_file(edit=bad), D.validate_parameters(PARAMS))
    msg = " ".join(exc.value.errors)
    assert "vehicle animals have dose 0" in msg and "duplicate" in msg


def test_covers_the_respiratory_part_with_a_signed_conclusion():
    assert D.components_for("safety.core_battery") == ("respiratory",)
    det = {d.key: d for d in D.expert_determinations(D.validate_parameters(PARAMS))}
    assert det["overall_conclusion"].required_for_approval
