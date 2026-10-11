"""IVIVE chain: exact recovery and the analytical limits of the well-stirred model."""

import math

import pytest

from hos.core.adme import (
    classify_extraction,
    clint_in_vitro,
    extraction_ratio,
    fit_depletion,
    fu_blood_from_plasma,
    fu_mic_hallifax_houston,
    hepatic_clearance_well_stirred,
    ivive_from_depletion,
    scale_clint_to_liver,
)
from hos.core.methods import method
from hos.core.provenance import Provenance
from hos.core.qc import QCStatus
from hos.core.quantity import MeasurementSeries, Quantity

T_HALF = 20.0
K = math.log(2) / T_HALF
TIMES = (0.0, 5.0, 15.0, 30.0, 45.0, 60.0)


def _series(k=K, times=TIMES):
    return MeasurementSeries(
        x=times, y=tuple(100 * math.exp(-k * t) for t in times),
        x_unit="min", y_unit="percent",
        provenance=Provenance.measured(source_name="LC-MS/MS"),
    )


PROT = Quantity.user_supplied(0.5, "mg/mL", actor="setup")
FUP = Quantity.measured(0.1, "dimensionless", source_name="RED")
BP = Quantity.measured(1.0, "dimensionless", source_name="B:P")


def test_half_life_is_recovered_exactly():
    fit = fit_depletion(_series())
    assert fit.half_life.value == pytest.approx(T_HALF, rel=1e-9)
    assert fit.qc.status is QCStatus.PASS


def test_clint_matches_obach_half_life_method():
    clint = clint_in_vitro(fit_depletion(_series()), PROT)
    assert clint.value == pytest.approx(K * 1000 / 0.5, rel=1e-12)
    assert clint.unit == "uL/min/mg"


def test_liver_scaling_uses_cited_human_scalars():
    clint = clint_in_vitro(fit_depletion(_series()), PROT)
    iv = scale_clint_to_liver(clint, "human")
    assert iv.value == pytest.approx(K * 1000 / 0.5 * 40.0 * 21.4 / 1000, rel=1e-12)
    assert iv.provenance.parameter_set_version


def test_well_stirred_hand_calculation():
    clint = scale_clint_to_liver(clint_in_vitro(fit_depletion(_series()), PROT), "human")
    fub = fu_blood_from_plasma(FUP, BP)
    clh = hepatic_clearance_well_stirred(clint, fub, "human")
    c = clint.value
    assert clh.value == pytest.approx((20.7 * 0.1 * c) / (20.7 + 0.1 * c), rel=1e-12)


def test_well_stirred_limit_clearance_limited():
    m = method("adme.clint_invivo")
    tiny = Quantity.computed(1e-3, "mL/min/kg", method=m)
    one = Quantity.measured(1.0, "dimensionless", source_name="t")
    assert hepatic_clearance_well_stirred(tiny, one, "human").value == pytest.approx(1e-3, rel=1e-3)


def test_well_stirred_limit_flow_limited():
    m = method("adme.clint_invivo")
    huge = Quantity.computed(1e8, "mL/min/kg", method=m)
    one = Quantity.measured(1.0, "dimensionless", source_name="t")
    assert hepatic_clearance_well_stirred(huge, one, "human").value == pytest.approx(20.7, rel=1e-4)


def test_extraction_bands():
    m = method("adme.extraction_ratio")
    for v, band in ((0.1, "low"), (0.5, "intermediate"), (0.9, "high")):
        assert classify_extraction(Quantity.computed(v, "dimensionless", method=m)) == band


def test_flat_series_fails_honestly_and_propagates():
    flat = MeasurementSeries(x=(0.0, 15.0, 30.0, 60.0), y=(100.0, 100.3, 99.9, 100.2),
                             x_unit="min", y_unit="percent",
                             provenance=Provenance.measured(source_name="LC-MS/MS"))
    res = ivive_from_depletion(flat, species="human", protein_concentration=PROT,
                               fu_plasma=FUP, blood_plasma_ratio=BP)
    assert not res.clh.is_available
    assert res.extraction_class == "undetermined"
    assert res.qc.status is QCStatus.FAIL


def test_low_depletion_is_warned_not_hidden():
    slow = _series(k=math.log(2) / 600.0)  # t1/2 = 10 h -> ~7% depletion in 60 min
    fit = fit_depletion(slow)
    assert "insufficient_depletion" in fit.qc.flags


def test_fu_mic_prediction_and_domain():
    lp = Quantity.computed(8.5, "dimensionless", method=method("descr.clogp"))
    fu = fu_mic_hallifax_houston(lp, PROT)
    assert fu.kind.value == "predicted"
    assert "out_of_applicability_domain" in fu.qc_flags


def test_fu_mic_correction_increases_clearance():
    clint = clint_in_vitro(fit_depletion(_series()), PROT)
    lp = Quantity.computed(4.0, "dimensionless", method=method("descr.clogp"))
    fu = fu_mic_hallifax_houston(lp, PROT)
    assert scale_clint_to_liver(clint, "human", fu_mic=fu).value > scale_clint_to_liver(clint, "human").value


def test_unverified_reference_scalar_is_flagged():
    clint = clint_in_vitro(fit_depletion(_series()), PROT)
    iv = scale_clint_to_liver(clint, "dog")
    assert "reference_value_requires_verification" in iv.qc_flags
