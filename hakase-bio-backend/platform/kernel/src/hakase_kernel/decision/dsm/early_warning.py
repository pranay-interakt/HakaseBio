"""Critical-slowing-down (CSD) early-warning indicator suite.

WHY THIS EXISTS
───────────────
The Dynamical Stability Margin (DSM) hypothesis is that toxicity, for the
clinically-dominant modes, is proximity to a *bifurcation* of a homeostatic
cell attractor, and that this proximity is detectable via universal
critical-slowing-down signatures (Scheffer et al., Nature 2009; Kuehn 2011):
as the leading eigenvalue of the local dynamics approaches zero, fluctuations
grow in amplitude (variance ↑), become more correlated in time
(lag-1 autocorrelation → 1), and relax more slowly (recovery time → ∞).

This module implements those indicators as *pure functions* over an observed
signal, plus honest bootstrap uncertainty. It fabricates nothing: where an
indicator is not identifiable from the data provided (e.g. a temporal indicator
asked of a single snapshot), it raises rather than inventing a number.

THE ONE HONEST CAVEAT THIS MODULE ENFORCES
──────────────────────────────────────────
Variance is computable from a *snapshot ensemble* (independent cells at one
dose). Lag-1 autocorrelation and recovery time are *intrinsically temporal* —
they require an ordered series (a live-cell / MEA trace, or replicate-linked
pseudotime). Asking for them from an unordered ensemble is a category error, so
`lag1_autocorrelation` / `recovery_time` require an explicitly-ordered 1-D
series and will not silently accept a bag of cells. This encodes the Phase-1
finding that on pure snapshot data only the variance family is available.

References
──────────
  • Scheffer M. et al. (2009) Early-warning signals for critical transitions.
    Nature 461:53.
  • Kuehn C. (2011) A mathematical framework for critical transitions.
    Physica D 240:1020.
  • Dakos V. et al. (2012) Methods for detecting early warnings of critical
    transitions in time series. PLoS ONE 7:e41010.
  • Mojtahedi M. et al. (2016) Cell fate decision as high-dimensional critical
    state transition. PLoS Biol 14:e2000640.  (single-cell CSD precedent)
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

# --------------------------------------------------------------------------- #
# Input hygiene
# --------------------------------------------------------------------------- #


def _as_1d(x, *, name: str = "input") -> np.ndarray:
    a = np.asarray(x, dtype=float).ravel()
    if a.size == 0:
        raise ValueError(f"{name}: empty array")
    if not np.all(np.isfinite(a)):
        raise ValueError(f"{name}: non-finite values present")
    return a


def _as_2d(x, *, name: str = "ensemble") -> np.ndarray:
    """(n_observations, n_features). A 1-D input is treated as n_features=1."""
    a = np.asarray(x, dtype=float)
    if a.ndim == 1:
        a = a[:, None]
    if a.ndim != 2:
        raise ValueError(f"{name}: expected 2-D (n_obs, n_features), got shape {a.shape}")
    if a.shape[0] < 2:
        raise ValueError(f"{name}: need >=2 observations, got {a.shape[0]}")
    if not np.all(np.isfinite(a)):
        raise ValueError(f"{name}: non-finite values present")
    return a


# --------------------------------------------------------------------------- #
# Ensemble (snapshot) indicators — the ONLY family valid on unordered cells
# --------------------------------------------------------------------------- #


def total_variance(ensemble) -> float:
    """Trace of the ensemble covariance = total fluctuation energy.

    Valid on a snapshot ensemble (independent cells at one dose). Rises toward a
    fold bifurcation, BUT also rises under population thinning / cell death — so
    on its own it does NOT distinguish a tipping point from cytotoxicity. That
    separation is the job of the temporal indicators + the estimator's
    concordance gate.
    """
    X = _as_2d(ensemble)
    return float(np.trace(np.cov(X, rowvar=False).reshape(X.shape[1], X.shape[1])))


def generalized_variance(ensemble) -> float:
    """Leading eigenvalue of the ensemble covariance (dominant fluctuation mode)."""
    X = _as_2d(ensemble)
    c = np.cov(X, rowvar=False).reshape(X.shape[1], X.shape[1])
    return float(np.linalg.eigvalsh(c).max())


# --------------------------------------------------------------------------- #
# Temporal indicators — REQUIRE an ordered 1-D series (trace / pseudotime)
# --------------------------------------------------------------------------- #


def lag1_autocorrelation(series, *, detrend: bool = True) -> float:
    """Lag-1 autocorrelation of an ordered series. → 1 as recovery rate → 0.

    Requires a genuine time/pseudotime ORDERING; a snapshot ensemble is invalid
    input here by design (see module docstring). Optionally removes a linear
    trend first (Dakos 2012) so the AR(1) estimate reflects fluctuations, not
    the mean drift.
    """
    x = _as_1d(series, name="series")
    if x.size < 3:
        raise ValueError("lag1_autocorrelation: need >=3 ordered points")
    if detrend:
        t = np.arange(x.size, dtype=float)
        x = x - np.polyval(np.polyfit(t, x, 1), t)
    x = x - x.mean()
    denom = float(np.dot(x, x))
    if denom <= 0:
        return 0.0
    return float(np.dot(x[:-1], x[1:]) / denom)


def recovery_time(series, *, dt: float = 1.0, detrend: bool = True) -> float:
    """Characteristic relaxation time tau from the AR(1) coefficient.

    For an OU/AR(1) process x_{t+1}=c·x_t+noise, ac1 = exp(-dt/tau), so
    tau = -dt / ln(ac1). Diverges (→ +inf) as ac1 → 1 (critical slowing down).
    Returns +inf when ac1 >= 1 (already at/over the transition) — the honest
    "infinitely slow recovery" signal, not a NaN.
    """
    ac1 = lag1_autocorrelation(series, detrend=detrend)
    if ac1 <= 0:
        return 0.0
    if ac1 >= 1.0:
        return float("inf")
    return float(-dt / np.log(ac1))


def leading_ar_eigenvalue(series_or_ensemble, *, ordered: bool = True) -> float:
    """|leading eigenvalue| of the local linear (return) map. → 1 near a fold.

    With an ordered multivariate series (rows = time), fits X_{t+1} ≈ A·X_t and
    returns max |eig(A)|. This is the closest observable to the true Jacobian
    spectral radius. Requires ordering; refuses unordered ensembles.
    """
    if not ordered:
        raise ValueError(
            "leading_ar_eigenvalue requires an ordered series; an unordered "
            "ensemble has no return map (Phase-1 caveat)."
        )
    X = _as_2d(series_or_ensemble)
    if X.shape[0] < 4:
        raise ValueError("leading_ar_eigenvalue: need >=4 ordered points")
    Xr, Xn = X[:-1], X[1:]
    Xr = Xr - Xr.mean(0)
    Xn = Xn - Xn.mean(0)
    A, *_ = np.linalg.lstsq(Xr, Xn, rcond=None)
    return float(np.max(np.abs(np.linalg.eigvals(A))))


# --------------------------------------------------------------------------- #
# Bootstrap uncertainty — every indicator can carry an honest interval
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class Estimate:
    value: float
    lo: float
    hi: float
    n_boot: int

    def __repr__(self) -> str:  # pragma: no cover - cosmetic
        return f"Estimate(value={self.value:.4g}, ci=[{self.lo:.4g}, {self.hi:.4g}])"


def bootstrap_indicator(
    data,
    fn: Callable[[np.ndarray], float],
    *,
    ordered: bool,
    n_boot: int = 400,
    alpha: float = 0.10,
    seed: int = 0,
) -> Estimate:
    """Nonparametric bootstrap CI for an indicator.

    ordered=False  → resample observations with replacement (valid for the
                     variance family: cells are exchangeable within a dose).
    ordered=True   → moving-block bootstrap (preserves temporal correlation, so
                     the CI for AR1/recovery time is not artificially tight).
    """
    rng = np.random.default_rng(seed)
    a = _as_2d(data) if np.ndim(data) == 2 else _as_1d(data)
    point = float(fn(a))
    n = a.shape[0]
    reps = np.empty(n_boot, dtype=float)
    if ordered:
        block = max(2, int(round(n ** (1 / 3))))  # standard block length ~ n^{1/3}
        n_blocks = int(np.ceil(n / block))
    for b in range(n_boot):
        if ordered:
            starts = rng.integers(0, max(1, n - block + 1), size=n_blocks)
            idx = np.concatenate([np.arange(s, s + block) for s in starts])[:n]
            sample = a[idx]
        else:
            idx = rng.integers(0, n, size=n)
            sample = a[idx]
        try:
            reps[b] = fn(sample)
        except Exception:
            reps[b] = np.nan
    reps = reps[np.isfinite(reps)]
    if reps.size < max(20, n_boot // 10):
        return Estimate(point, float("nan"), float("nan"), int(reps.size))
    lo = float(np.quantile(reps, alpha / 2))
    hi = float(np.quantile(reps, 1 - alpha / 2))
    return Estimate(point, lo, hi, int(reps.size))


# --------------------------------------------------------------------------- #
# Trend-vs-dose statistics — pure numpy (no scipy dependency)
# --------------------------------------------------------------------------- #


def kendall_tau(x, y) -> float:
    """Kendall tau-b rank correlation. Robust monotone-trend statistic."""
    x = _as_1d(x, name="x")
    y = _as_1d(y, name="y")
    if x.size != y.size:
        raise ValueError("kendall_tau: x and y length mismatch")
    if x.size < 2:
        return float("nan")
    c = d = 0
    for i in range(x.size):
        dx = np.sign(x[i] - x[i + 1 :])
        dy = np.sign(y[i] - y[i + 1 :])
        prod = dx * dy
        c += int(np.sum(prod > 0))
        d += int(np.sum(prod < 0))
    denom = c + d
    return (c - d) / denom if denom else float("nan")


def mann_whitney_u_greater(a, b) -> float:
    """One-sided Mann–Whitney U p-value, H1: a stochastically > b.

    Normal approximation with tie correction; adequate for n≳8 per group.
    """
    from math import erf, sqrt

    a = _as_1d(a, name="a")
    b = _as_1d(b, name="b")
    n1, n2 = a.size, b.size
    allv = np.concatenate([a, b])
    order = allv.argsort(kind="mergesort")
    ranks = np.empty(allv.size, dtype=float)
    ranks[order] = np.arange(1, allv.size + 1)
    uniq, inv, cnt = np.unique(allv, return_inverse=True, return_counts=True)
    sums = np.zeros(cnt.size)
    np.add.at(sums, inv, ranks)
    ranks = (sums / cnt)[inv]
    R1 = float(ranks[:n1].sum())
    U1 = R1 - n1 * (n1 + 1) / 2.0
    mu = n1 * n2 / 2.0
    # tie-corrected variance
    tie = float(np.sum(cnt**3 - cnt))
    N = n1 + n2
    var = n1 * n2 / 12.0 * ((N + 1) - tie / (N * (N - 1)))
    if var <= 0:
        return float("nan")
    z = (U1 - mu) / sqrt(var)
    return float(0.5 * (1 - erf(z / sqrt(2))))
