"""Tests for the S1-T4 kernel uncertainty helpers.

Covers:
  * residuals -> lognormal error model (fit, interval, sampling);
  * distance-based applicability domain returning in / edge / out on fixtures.

Modality-agnostic: pure numpy + stdlib, no RDKit. Run:
    pytest platform/kernel/tests/test_uncertainty_helpers.py -q
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from hakase_kernel.uncertainty import ad_distance as AD
from hakase_kernel.uncertainty import residuals as R

# --------------------------------------------------------------------------- #
# residuals -> lognormal
# --------------------------------------------------------------------------- #


def test_fit_recovers_mu_and_sigma():
    rng = np.random.default_rng(42)
    ln_resid = rng.normal(0.1, 0.3, size=5000)  # true log-bias 0.1, log-sd 0.3
    err = R.fit_lognormal_residuals(ln_resid)
    assert err.n == 5000
    assert err.mu == pytest.approx(0.1, abs=0.02)
    assert err.sigma == pytest.approx(0.3, abs=0.02)
    assert err.geometric_sd == pytest.approx(math.exp(err.sigma))
    assert err.geometric_mean_bias == pytest.approx(math.exp(err.mu))


def test_residuals_from_predictions_are_log_ratio():
    r = R.residuals_from_predictions(predicted=[1.0, 2.0, 4.0], observed=[2.0, 4.0, 8.0])
    # every observed is exactly 2x predicted -> ln(2) residual, zero spread.
    assert np.allclose(r, math.log(2.0))
    err = R.fit_lognormal_residuals(r)
    assert err.mu == pytest.approx(math.log(2.0))
    assert err.sigma == pytest.approx(0.0)


def test_lognormal_interval_is_multiplicative_and_covers():
    err = R.LogNormalError(mu=0.0, sigma=0.3, n=100)
    lo, hi = err.interval(10.0, coverage=0.90)
    # Unbiased + symmetric in log space -> geometric-symmetric around the point.
    assert lo < 10.0 < hi
    assert math.sqrt(lo * hi) == pytest.approx(10.0)
    # 90% central interval -> z = 1.645 in log space.
    assert hi == pytest.approx(10.0 * math.exp(1.6448536 * 0.3), rel=1e-4)


def test_base_log10_is_converted():
    err = R.fit_lognormal_residuals([0.3, 0.3, 0.3], base="log10")  # log10 bias 0.3
    assert err.mu == pytest.approx(0.3 * math.log(10.0))
    assert err.geometric_mean_bias == pytest.approx(10.0**0.3)


def test_sample_is_positive_and_reproducible():
    err = R.LogNormalError(mu=0.0, sigma=0.25, n=50)
    s1 = err.sample(5.0, size=1000, rng=np.random.default_rng(7))
    s2 = err.sample(5.0, size=1000, rng=np.random.default_rng(7))
    assert np.all(s1 > 0.0)
    assert np.array_equal(s1, s2)  # seed-reproducible
    assert np.median(s1) == pytest.approx(5.0, rel=0.1)  # median ~ point (unbiased)


def test_residual_input_validation():
    with pytest.raises(ValueError):
        R.fit_lognormal_residuals([])
    with pytest.raises(ValueError):
        R.fit_lognormal_residuals([1.0, np.inf])
    with pytest.raises(ValueError):
        R.residuals_from_predictions([1.0, -2.0], [1.0, 2.0])  # non-positive
    with pytest.raises(ValueError):
        R.residuals_from_predictions([1.0], [1.0, 2.0])  # length mismatch
    with pytest.raises(ValueError):
        R.LogNormalError(mu=0.0, sigma=-0.1, n=10)  # negative sigma
    with pytest.raises(ValueError):
        R.LogNormalError(mu=0.0, sigma=0.1, n=10).interval(-1.0)  # non-positive point


# --------------------------------------------------------------------------- #
# applicability domain: tanimoto fixture -> in / edge / out
# --------------------------------------------------------------------------- #


def _bits(indices: list[int], nbits: int = 20) -> list[int]:
    v = [0] * nbits
    for i in indices:
        v[i] = 1
    return v


def test_tanimoto_returns_in_edge_out():
    reference = [_bits(list(range(10))), _bits([15, 16, 17])]
    ad = AD.ApplicabilityDomain.fit(reference, metric="tanimoto")

    in_q = _bits(list(range(10)))  # identical to ref0 -> Tanimoto 1.0
    edge_q = _bits([0, 1, 2, 3, 4])  # 5 of ref0's 10 bits -> 5/10 = 0.5
    out_q = _bits([0, 10, 11, 12, 13])  # 1 shared, 13 union -> ~0.077

    assert ad.classify(in_q).state is AD.DomainState.IN
    assert ad.classify(in_q).score == pytest.approx(1.0)
    edge = ad.classify(edge_q)
    assert edge.state is AD.DomainState.EDGE
    assert edge.score == pytest.approx(0.5)
    assert ad.classify(out_q).state is AD.DomainState.OUT


# --------------------------------------------------------------------------- #
# applicability domain: euclidean
# --------------------------------------------------------------------------- #


def test_euclidean_explicit_thresholds_in_edge_out():
    # Raw (unstandardised) space with explicit distance thresholds.
    ad = AD.ApplicabilityDomain.fit(
        [[0.0], [10.0]],
        metric="euclidean",
        standardize=False,
        in_threshold=1.0,
        edge_threshold=3.0,
    )
    assert ad.classify([0.0]).state is AD.DomainState.IN  # dist 0
    assert ad.classify([2.0]).state is AD.DomainState.EDGE  # dist 2 (1 < 2 <= 3)
    assert ad.classify([5.0]).state is AD.DomainState.OUT  # dist 5 (> 3)
    # score is in [0, 1] and decreases with distance.
    assert ad.classify([0.0]).score > ad.classify([2.0]).score > ad.classify([5.0]).score
    assert 0.0 <= ad.classify([5.0]).score <= 1.0


def test_euclidean_percentile_calibration_in_and_out():
    rng = np.random.default_rng(0)
    reference = rng.normal(0.0, 1.0, size=(200, 3))  # a training cloud
    ad = AD.ApplicabilityDomain.fit(reference, metric="euclidean")
    # A point in the middle of the cloud is in-domain; a far point is out.
    assert ad.classify([0.0, 0.0, 0.0]).state is AD.DomainState.IN
    assert ad.classify([20.0, 20.0, 20.0]).state is AD.DomainState.OUT


def test_classify_many_matches_individual():
    ad = AD.ApplicabilityDomain.fit(
        [[0.0], [10.0]], metric="euclidean", standardize=False, in_threshold=1.0, edge_threshold=3.0
    )
    verdicts = ad.classify_many([[0.0], [2.0], [5.0]])
    assert [v.state for v in verdicts] == [
        AD.DomainState.IN,
        AD.DomainState.EDGE,
        AD.DomainState.OUT,
    ]


def test_ad_input_validation():
    ad = AD.ApplicabilityDomain.fit([[0.0], [1.0]], metric="euclidean", standardize=False)
    with pytest.raises(AD.ADError):
        ad.classify([1.0, 2.0])  # wrong feature dimension
    with pytest.raises(AD.ADError):
        AD.ApplicabilityDomain.fit([[1.0]], metric="nonsense")
    with pytest.raises(AD.ADError):
        AD.ApplicabilityDomain.fit(np.zeros((0, 3)), metric="euclidean")
    with pytest.raises(AD.ADError):
        # euclidean requires in_threshold <= edge_threshold
        AD.ApplicabilityDomain.fit(
            [[0.0], [1.0]], metric="euclidean", in_threshold=5.0, edge_threshold=1.0
        )
