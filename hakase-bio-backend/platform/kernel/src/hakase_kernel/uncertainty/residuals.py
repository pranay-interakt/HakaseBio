"""ML validation residuals -> an input error distribution (kernel, S1-T4).

The PBPK uncertainty pipeline (S1-T5) wraps each ML-sourced input (CLint, fu,
VDss, ...) in a distribution and Monte-Carlo-propagates it through the pure PK
core. This module turns a model's held-out **validation residuals** into that
distribution.

For pharmacokinetic parameters the error is **multiplicative** — a clearance is
"within 2-fold", not "within 5 mL/min" — so residuals are analysed in log space
and the parameter error is **lognormal**. A residual is defined as
``r = ln(observed / predicted)``; fitting ``r ~ Normal(mu, sigma)`` gives a
lognormal multiplicative error: the truth behind a point estimate ``x`` is
``x · exp(Normal(mu, sigma))``. ``mu`` captures systematic log-bias (0 =
unbiased); ``exp(sigma)`` is the geometric SD (the fold-spread).

Modality-agnostic: pure ``numpy`` + stdlib (``statistics.NormalDist`` for the
Gaussian quantiles). No RDKit, no SMILES, nothing modality-specific.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from typing import Any

import numpy as np

_LN10 = math.log(10.0)
_STD_NORMAL = statistics.NormalDist(0.0, 1.0)


@dataclass(frozen=True)
class LogNormalError:
    """A multiplicative (lognormal) error model in natural-log space.

    ``mu`` — mean of ``ln(observed/predicted)``; the systematic log-bias.
    ``sigma`` — SD of the log-residuals; the dispersion (``>= 0``).
    ``n`` — number of residuals it was fitted from.
    """

    mu: float
    sigma: float
    n: int

    def __post_init__(self) -> None:
        if not math.isfinite(self.mu) or not math.isfinite(self.sigma):
            raise ValueError(f"mu and sigma must be finite, got mu={self.mu}, sigma={self.sigma}")
        if self.sigma < 0.0:
            raise ValueError(f"sigma must be >= 0, got {self.sigma}")
        if self.n < 1:
            raise ValueError(f"n must be >= 1, got {self.n}")

    @property
    def geometric_mean_bias(self) -> float:
        """``exp(mu)`` — typical ``observed/predicted`` factor (1.0 = unbiased)."""
        return math.exp(self.mu)

    @property
    def geometric_sd(self) -> float:
        """``exp(sigma)`` — geometric standard deviation (the fold-spread)."""
        return math.exp(self.sigma)

    def interval(self, point: float, coverage: float = 0.9) -> tuple[float, float]:
        """Two-sided multiplicative interval on a positive point estimate.

        Returns ``(low, high) = point · exp(mu + z·sigma)`` at the ``coverage``
        central probability (e.g. 0.9 -> 5th/95th percentiles).
        """
        if point <= 0.0:
            raise ValueError(f"point must be > 0 for a lognormal interval, got {point}")
        if not (0.0 < coverage < 1.0):
            raise ValueError(f"coverage must be in (0, 1), got {coverage}")
        z_lo = _STD_NORMAL.inv_cdf((1.0 - coverage) / 2.0)
        z_hi = _STD_NORMAL.inv_cdf((1.0 + coverage) / 2.0)
        low = point * math.exp(self.mu + z_lo * self.sigma)
        high = point * math.exp(self.mu + z_hi * self.sigma)
        return (low, high)

    def sample(self, point: float, size: int, rng: np.random.Generator) -> np.ndarray:
        """Draw ``size`` Monte-Carlo values for a point estimate: ``point·exp(N(mu,sigma))``."""
        if point <= 0.0:
            raise ValueError(f"point must be > 0, got {point}")
        return point * np.exp(rng.normal(self.mu, self.sigma, size))

    def to_dict(self) -> dict[str, Any]:
        return {
            "distribution": "lognormal",
            "mu": self.mu,
            "sigma": self.sigma,
            "geometric_mean_bias": self.geometric_mean_bias,
            "geometric_sd": self.geometric_sd,
            "n": self.n,
        }


def _to_ln(arr: np.ndarray, base: str) -> np.ndarray:
    if base == "ln":
        return arr
    if base == "log10":
        return arr * _LN10
    raise ValueError(f"base must be 'ln' or 'log10', got {base!r}")


def residuals_from_predictions(predicted: Any, observed: Any, *, base: str = "ln") -> np.ndarray:
    """Log-residuals ``ln(observed/predicted)`` from paired positive values.

    PK parameters are strictly positive; a non-positive value raises rather than
    producing a silent NaN. ``base`` selects the returned residual scale.
    """
    p = np.asarray(predicted, dtype=float).ravel()
    o = np.asarray(observed, dtype=float).ravel()
    if p.size == 0 or p.size != o.size:
        raise ValueError(
            f"predicted and observed must be same non-empty length, got {p.size}, {o.size}"
        )
    if not (np.all(p > 0.0) and np.all(o > 0.0)):
        raise ValueError("predicted and observed must be strictly positive (PK parameters)")
    r = np.log(o) - np.log(p)  # ln(observed / predicted)
    if base == "log10":
        return r / _LN10
    if base != "ln":
        raise ValueError(f"base must be 'ln' or 'log10', got {base!r}")
    return r


def fit_lognormal_residuals(
    residuals: Any, *, base: str = "ln", assume_unbiased: bool = False
) -> LogNormalError:
    """Fit a :class:`LogNormalError` to a 1-D array of residuals.

    ``residuals`` are ``ln`` (or ``log10``, via ``base``) of ``observed/predicted``.
    ``assume_unbiased`` pins ``mu = 0`` (keep only the model's dispersion, discard
    any apparent bias) — useful when the validation set is too small to trust the
    bias estimate. ``sigma`` is the sample SD (``ddof=1``; 0 for a single point).
    """
    arr = np.asarray(residuals, dtype=float).ravel()
    if arr.size == 0:
        raise ValueError("residuals must be non-empty")
    if not np.all(np.isfinite(arr)):
        raise ValueError("residuals must all be finite")
    arr = _to_ln(arr, base)
    mu = 0.0 if assume_unbiased else float(arr.mean())
    sigma = float(arr.std(ddof=1)) if arr.size > 1 else 0.0
    return LogNormalError(mu=mu, sigma=sigma, n=int(arr.size))


def fit_lognormal_from_predictions(
    predicted: Any, observed: Any, *, base: str = "ln", assume_unbiased: bool = False
) -> LogNormalError:
    """Convenience: :func:`residuals_from_predictions` then :func:`fit_lognormal_residuals`."""
    r = residuals_from_predictions(predicted, observed, base=base)
    return fit_lognormal_residuals(r, base=base, assume_unbiased=assume_unbiased)


__all__ = [
    "LogNormalError",
    "residuals_from_predictions",
    "fit_lognormal_residuals",
    "fit_lognormal_from_predictions",
]
