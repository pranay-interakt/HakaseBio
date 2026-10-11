"""Dose proportionality by the power model with a confidence-interval criterion.

Model (Smith et al. 2000, abstract): ``PK = beta0 * Dose**beta1``, linear on the log scale,
``ln(PK) = ln(beta0) + beta1 * ln(Dose)``. Exposure is dose-proportional when beta1 = 1.

Criterion: the ratio of dose-normalised means at the extremes of the dose range, Rdnm, must
have its confidence interval wholly inside an acceptance interval (theta_L, theta_H) fixed in
advance (Smith 2000; Hummel et al. 2009, who define Rdnm at the extremes of the dose range).
Under the power model Rdnm = r**(beta1 - 1), with r = highest / lowest dose, so the criterion
is equivalent to the beta1 confidence interval lying inside

    [1 + ln(theta_L) / ln(r),  1 + ln(theta_H) / ln(r)]

This is the form reproduced in Braeckman et al. 2022 (r = 2, theta = 0.8/1.25 gives
[0.6781, 1.3219]) and Shang et al. 2022 (rats, r = 4, theta = 0.5/2.0 gives [0.500, 1.500]).
No source fixes theta: 0.8/1.25 and 0.5/2 are both in use (Hummel 2009), so theta and the
confidence level are inputs.

Fit: ordinary least squares of ln(PK) on ln(dose) over individual observations, as in Shang
et al. 2022 for a parallel-group rat design. Smith 2000 fitted mixed-effects models for
designs in which each subject receives several doses; in a parallel-group design each animal
contributes one observation, so a random subject effect cannot be separated from residual
error and the model reduces to this regression. The interval is the t-interval on the slope
with n - 2 degrees of freedom.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from scipy import stats

__all__ = ["PowerModelFit", "acceptance_interval", "fit_power_model"]


def acceptance_interval(dose_ratio: float, theta_low: float, theta_high: float
                        ) -> tuple[float, float]:
    """beta1 interval equivalent to Rdnm in (theta_low, theta_high) for dose ratio r."""
    if dose_ratio <= 1:
        raise ValueError("the dose ratio (highest / lowest) must exceed 1")
    if not 0 < theta_low < 1 < theta_high:
        raise ValueError("acceptance limits need 0 < theta_low < 1 < theta_high")
    lr = math.log(dose_ratio)
    return 1 + math.log(theta_low) / lr, 1 + math.log(theta_high) / lr


@dataclass(frozen=True, slots=True)
class PowerModelFit:
    n: int
    n_doses: int
    dose_ratio: float
    beta1: float
    ln_beta0: float
    se_beta1: float | None
    ci_level: float
    ci: tuple[float, float] | None


def fit_power_model(doses: Sequence[float], values: Sequence[float], *,
                    ci_level: float) -> PowerModelFit:
    """Fit ln(value) = ln(beta0) + beta1 ln(dose) by least squares.

    Doses and values must be positive (the log of zero is undefined; callers exclude control
    groups and unquantifiable exposure and say so)."""
    if not 0 < ci_level < 1:
        raise ValueError("the confidence level is a fraction between 0 and 1")
    d_arr, v_arr = np.asarray(doses, dtype=float), np.asarray(values, dtype=float)
    if len(d_arr) != len(v_arr):
        raise ValueError("doses and values differ in length")
    if np.any(d_arr <= 0) or np.any(v_arr <= 0) or not np.all(np.isfinite(v_arr)):
        raise ValueError("doses and exposure values must be positive")
    x, y = np.log(d_arr), np.log(v_arr)
    distinct = sorted(set(d_arr.tolist()))
    if len(distinct) < 2:
        raise ValueError("at least two distinct dose levels are needed")
    n = len(x)
    xbar, ybar = float(np.mean(x)), float(np.mean(y))
    sxx = float(np.sum((x - xbar) ** 2))
    beta1 = float(np.sum((x - xbar) * (y - ybar)) / sxx)
    ln_beta0 = ybar - beta1 * xbar
    se: float | None = None
    ci: tuple[float, float] | None = None
    if n > 2:
        resid = y - (ln_beta0 + beta1 * x)
        s2 = float(np.sum(resid ** 2)) / (n - 2)
        se = math.sqrt(s2 / sxx)
        t = float(stats.t.ppf(1 - (1 - ci_level) / 2, n - 2))
        ci = (beta1 - t * se, beta1 + t * se)
    return PowerModelFit(n=n, n_doses=len(distinct), dose_ratio=distinct[-1] / distinct[0],
                         beta1=beta1, ln_beta0=ln_beta0, se_beta1=se, ci_level=ci_level, ci=ci)
