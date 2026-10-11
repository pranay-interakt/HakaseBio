"""Peptide depletion fits: exact synthetic cases with analytical solutions (plan section 5
item 4) and the censoring and plateau rules from docs/research/drivers/peptide_stability.md."""

import math

import numpy as np
import pytest
from scipy import stats

from hos.core.peptide_stability import fit_decay, percent_of_time_zero

T = [0, 15, 30, 60, 120, 240]


def _first_order(t_half, times=T, scale=100.0):
    return [scale * math.exp(-math.log(2) / t_half * t) for t in times]


def test_first_order_recovers_an_exact_half_life():
    f = fit_decay(
        T, _first_order(60), model="first_order", min_r2=0.9, min_depletion_pct=20, label="x"
    )
    assert f.half_life.value == pytest.approx(60, rel=1e-12)
    assert f.k.value == pytest.approx(math.log(2) / 60, rel=1e-12)
    assert f.qc.passed and not f.censored
    assert f.half_life.provenance.method.id == "peptide.first_order_decay"


def test_one_phase_decay_recovers_half_life_and_plateau():
    """GraphPad one phase decay: Y = (Y0 - Plateau) exp(-K t) + Plateau, t1/2 = ln 2 / K."""
    k = math.log(2) / 30
    y = [80 * math.exp(-k * t) + 20 for t in T]
    f = fit_decay(T, y, model="one_phase_decay", min_r2=0.9, min_depletion_pct=20, label="x")
    assert f.half_life.value == pytest.approx(30, rel=1e-6)
    assert f.plateau.value == pytest.approx(20, abs=1e-6)
    assert any(x.code == "x.incomplete_degradation" for x in f.qc.findings)


def test_first_order_hides_a_plateau_so_it_is_checked():
    k = math.log(2) / 30
    y = [80 * math.exp(-k * t) + 20 for t in T]
    f = fit_decay(T, y, model="first_order", min_r2=0.5, min_depletion_pct=20, label="x")
    assert f.half_life.is_available
    assert any(x.code == "x.incomplete_degradation" for x in f.qc.findings)


def test_the_interval_is_the_slope_t_interval_transformed():
    rng = np.random.default_rng(3)
    times = [t for t in T for _ in range(3)]
    y = [
        v * math.exp(rng.normal(0, 0.05)) if t else 100.0
        for t, v in zip(times, _first_order(45, times), strict=True)
    ]
    f = fit_decay(times, y, model="first_order", min_r2=0.5, min_depletion_pct=20, label="x")
    reg = stats.linregress(times, np.log(y))
    tq = stats.t.ppf(0.975, len(times) - 2)
    k_lo, k_hi = -reg.slope - tq * reg.stderr, -reg.slope + tq * reg.stderr
    assert f.k.uncertainty.lower == pytest.approx(k_lo, rel=1e-12)
    assert f.half_life.uncertainty.lower == pytest.approx(math.log(2) / k_hi, rel=1e-12)
    assert f.half_life.uncertainty.upper == pytest.approx(math.log(2) / k_lo, rel=1e-12)


def test_a_half_life_beyond_the_last_sample_is_censored():
    f = fit_decay(
        T, _first_order(1000), model="first_order", min_r2=0.9, min_depletion_pct=5, label="x"
    )
    assert f.censored and not f.half_life.is_available
    assert "longer than the last sampling time (240 min)" in f.half_life.provenance.reason
    assert "84.7% remained" in f.half_life.provenance.reason


def test_no_decline_and_low_depletion():
    f = fit_decay(T, [100.0] * 6, model="first_order", min_r2=0.9, min_depletion_pct=20, label="x")
    assert not f.half_life.is_available
    assert any(x.code == "x.insufficient_depletion" for x in f.qc.findings)


def test_one_phase_needs_four_points():
    f = fit_decay(
        [0, 30, 60],
        _first_order(30, [0, 30, 60]),
        model="one_phase_decay",
        min_r2=0.9,
        min_depletion_pct=20,
        label="x",
    )
    assert not f.half_life.is_available and "four observations" in f.half_life.provenance.reason


def test_normalisation_to_the_replicates_time_zero():
    assert percent_of_time_zero({0.0: 250.0, 30.0: 125.0, 60.0: None}) == {0.0: 100.0, 30.0: 50.0}
    with pytest.raises(ValueError, match="time-zero"):
        percent_of_time_zero({0.0: None, 30.0: 1.0})
    with pytest.raises(ValueError):
        fit_decay(
            [0, 30], [100, 0], model="first_order", min_r2=0.9, min_depletion_pct=0, label="x"
        )
