"""Power-model dose proportionality: published acceptance intervals and exact recovery."""

import numpy as np
import pytest
from scipy import stats

from hos.core.dose_proportionality import acceptance_interval, fit_power_model


def test_acceptance_interval_reproduces_braeckman_2022():
    # Braeckman et al. 2022 (J Child Adolesc Psychopharmacol 32:288), R = 2, theta 0.8/1.25:
    # "The acceptance interval for dose proportionality ... is [0.6781, 1.3219]"
    lo, hi = acceptance_interval(2, 0.8, 1.25)
    assert (round(lo, 4), round(hi, 4)) == (0.6781, 1.3219)


def test_acceptance_interval_reproduces_shang_2022_rats():
    # Shang et al. 2022 (J Pharm Anal 12:278), rats 10-40 mg/kg (r = 4), theta 0.5/2.0:
    # acceptance interval 0.500-1.500 (Table 7)
    lo, hi = acceptance_interval(4, 0.5, 2.0)
    assert (round(lo, 3), round(hi, 3)) == (0.5, 1.5)


def test_exact_recovery_of_the_power_exponent():
    doses = [10, 10, 30, 30, 100, 100]
    fit = fit_power_model(doses, [3.0 * d**0.8 for d in doses], ci_level=0.9)
    assert fit.beta1 == pytest.approx(0.8, abs=1e-12)
    assert fit.ln_beta0 == pytest.approx(np.log(3.0), abs=1e-12)
    assert fit.se_beta1 == pytest.approx(0.0, abs=1e-12)
    assert fit.dose_ratio == 10 and fit.n_doses == 3


def test_slope_and_interval_match_an_independent_regression():
    rng = np.random.default_rng(1)
    doses = np.repeat([5.0, 15.0, 50.0], 6)
    vals = 2.0 * doses**1.1 * np.exp(rng.normal(0, 0.2, doses.size))
    fit = fit_power_model(doses.tolist(), vals.tolist(), ci_level=0.9)
    ref = stats.linregress(np.log(doses), np.log(vals))
    t = stats.t.ppf(0.95, doses.size - 2)
    assert fit.beta1 == pytest.approx(ref.slope, rel=1e-12)
    assert fit.se_beta1 == pytest.approx(ref.stderr, rel=1e-10)
    assert fit.ci == pytest.approx((ref.slope - t * ref.stderr, ref.slope + t * ref.stderr))


def test_invalid_inputs_are_refused():
    with pytest.raises(ValueError):
        fit_power_model([10, 10, 10], [1, 2, 3], ci_level=0.9)
    with pytest.raises(ValueError):
        fit_power_model([10, 20, 40], [0.0, 2, 3], ci_level=0.9)
    with pytest.raises(ValueError):
        acceptance_interval(1, 0.8, 1.25)
    with pytest.raises(ValueError):
        acceptance_interval(2, 1.2, 1.25)
