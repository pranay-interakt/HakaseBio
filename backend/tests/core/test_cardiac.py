"""QT correction formulae and within-animal summaries: hand-calculated values."""

import math

import numpy as np
import pytest
from scipy import stats

from hos.core.cardiac import correct_qt, individual_slope, rr_independence, t_summary


def test_formulae_agree_at_rr_one_second():
    for m in ("fridericia", "bazett", "van_de_water"):
        assert correct_qt(400, 1000, m) == pytest.approx(400)
    assert correct_qt(400, 1000, "individual", slope=0.2, rr_ref_ms=1000) == pytest.approx(400)


def test_formulae_hand_values_at_rr_640_ms():
    assert correct_qt(400, 640, "fridericia") == pytest.approx(400 / 0.64 ** (1 / 3))  # 464.16
    assert correct_qt(400, 640, "bazett") == pytest.approx(500.0)                     # 400/0.8
    assert correct_qt(400, 640, "van_de_water") == pytest.approx(400 + 0.087 * 360)   # 431.32


def test_individual_correction_removes_an_exact_linear_rate_dependence():
    rr = [300.0, 350.0, 400.0, 450.0, 500.0]
    qt = [120 + 0.25 * x for x in rr]
    b = individual_slope(qt, rr)
    assert b == pytest.approx(0.25)
    qtc = [correct_qt(q, r, "individual", slope=b, rr_ref_ms=400) for q, r in zip(qt, rr, strict=True)]
    assert qtc == pytest.approx([220.0] * 5)
    ind = rr_independence(qtc, rr)
    assert ind.slope == pytest.approx(0.0, abs=1e-12) and ind.n_pairs == 5


def test_rr_independence_matches_an_independent_regression():
    rng = np.random.default_rng(3)
    rr = rng.uniform(300, 600, 40)
    qtc = 250 + 0.05 * rr + rng.normal(0, 4, 40)
    ind = rr_independence(qtc.tolist(), rr.tolist())
    ref = stats.linregress(rr, qtc)
    t = stats.t.ppf(0.975, 38)
    assert ind.slope == pytest.approx(ref.slope) and ind.p_value == pytest.approx(ref.pvalue)
    assert ind.slope_ci == pytest.approx((ref.slope - t * ref.stderr, ref.slope + t * ref.stderr))


def test_t_summary_matches_a_one_sample_t_test():
    v = [4.0, 7.5, 10.0, 6.0, 9.5, 5.0]
    s = t_summary(v)
    ref = stats.ttest_1samp(v, 0.0)
    se = np.std(v, ddof=1) / math.sqrt(len(v))
    assert s.mean == pytest.approx(np.mean(v)) and s.p_value == pytest.approx(ref.pvalue)
    assert s.ci == pytest.approx((s.mean - stats.t.ppf(0.975, 5) * se,
                                  s.mean + stats.t.ppf(0.975, 5) * se))
    assert t_summary([3.0]).ci is None


def test_invalid_inputs():
    with pytest.raises(ValueError):
        correct_qt(400, 1000, "individual")
    with pytest.raises(ValueError):
        individual_slope([300, 301, 302], [400, 400, 400])
