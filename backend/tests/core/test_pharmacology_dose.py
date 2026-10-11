"""Hill fitting, hERG margins, and FDA 2005 starting-dose derivation."""

import numpy as np
import pytest

from hos.core.dose import DoseBasis, human_equivalent_dose, project_starting_dose
from hos.core.methods import method
from hos.core.pharmacology import fit_hill, four_parameter_logistic, herg_safety_margin
from hos.core.provenance import Provenance
from hos.core.quantity import MeasurementSeries, Quantity, QuantityError

CONC = np.array([0.01, 0.03, 0.1, 0.3, 1.0, 3.0, 10.0, 30.0, 100.0])


def _curve(ic50, conc=CONC):
    return MeasurementSeries(
        x=tuple(conc), y=tuple(four_parameter_logistic(conc, 0.0, 100.0, ic50, 1.0)),
        x_unit="uM", y_unit="percent", provenance=Provenance.measured(source_name="QPatch"),
    )


def test_exact_ic50_recovery():
    f = fit_hill(_curve(2.5))
    assert f.ic50.value == pytest.approx(2.5, rel=1e-4)
    assert f.hill_slope.value == pytest.approx(1.0, rel=1e-3)


def test_extrapolated_potency_is_flagged():
    f = fit_hill(_curve(50.0, conc=np.array([0.001, 0.003, 0.01, 0.03, 0.1])))
    assert f.extrapolated and "potency_extrapolated" in f.ic50.qc_flags


def test_too_few_points_rejected():
    with pytest.raises(QuantityError):
        fit_hill(_curve(1.0, conc=np.array([0.1, 1.0, 10.0])))


def test_herg_margin_and_reference_flag():
    ic50 = Quantity.computed(10.0, "uM", method=method("pharm.hill_4pl"))
    assert herg_safety_margin(ic50, Quantity.measured(0.1, "uM", source_name="PK")).value == 100.0
    low = herg_safety_margin(ic50, Quantity.measured(1.0, "uM", source_name="PK"))
    assert "herg_margin_below_30x_reference" in low.qc_flags


def test_hed_matches_fda_table():
    noael = Quantity.measured(100.0, "mg/kg", source_name="GLP rat")
    assert human_equivalent_dose(noael, "rat").hed.value == pytest.approx(100 * 6 / 37)
    noael_dog = Quantity.measured(30.0, "mg/kg", source_name="GLP dog")
    assert human_equivalent_dose(noael_dog, "dog").hed.value == pytest.approx(30 * 20 / 37)


def test_mrsd_selects_most_sensitive_species():
    p = project_starting_dose({
        "rat": Quantity.measured(100.0, "mg/kg", source_name="r"),
        "dog": Quantity.measured(10.0, "mg/kg", source_name="d"),
    })
    assert p.most_sensitive_species == "dog"
    assert p.mrsd_per_kg.value == pytest.approx(10 * 20 / 37 / 10)
    assert p.mrsd_total.value == pytest.approx(10 * 20 / 37 / 10 * 60)


def test_pad_governs_when_lower():
    p = project_starting_dose(
        {"rat": Quantity.measured(100.0, "mg/kg", source_name="r")},
        pad=Quantity.measured(0.2, "mg/kg", source_name="PD model"),
    )
    assert p.basis is DoseBasis.PAD and p.pad_governed


def test_reduced_safety_factor_requires_justification():
    with pytest.raises(QuantityError):
        project_starting_dose({"rat": Quantity.measured(100.0, "mg/kg", source_name="r")},
                              safety_factor=5.0)


def test_missing_noael_yields_unavailable_mrsd():
    p = project_starting_dose({"rat": Quantity.unavailable("mg/kg", reason="not reported")})
    assert not p.mrsd_per_kg.is_available
