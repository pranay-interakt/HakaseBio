"""Calibration assessment — the instrument that decides whether a confidence is real.

WHY THIS EXISTS
───────────────
A "confidence" or "probability" is only scientifically meaningful if it is
*calibrated*: among all predictions made with confidence p, a fraction ≈ p should
turn out correct. Hakase surfaces confidence-like numbers (e.g. the in-vitro panel's
"confidence: 0.72, reliability: High"). Some are principled (temperature/Platt from a
model bundle); some are heuristic maps of ensemble dispersion through a hand-picked
constant. This module provides the *measurement* that separates the two: point a
reliability curve / ECE / Brier decomposition at any (probability, outcome) sample and
it reports, with no fabrication, how well the number tracks reality — and a small set of
*post-hoc calibrators* (isotonic, temperature, Platt) to fix a miscalibrated score.

Everything here is pure NumPy, total, and validated. Where a statistic is not
identifiable from the sample provided (too few points, degenerate input) it raises or
returns an explicit not-estimable value rather than a silent number.

SCOPE / HONESTY
───────────────
Calibration is a *marginal, in-distribution* property: it is measured on a held-out
sample exchangeable with deployment. Under covariate shift it can degrade — that is the
job of :mod:`reasoning.ood` to flag. ECE is a biased estimator of true calibration error
and is binning-dependent; we therefore expose equal-width AND equal-mass (adaptive)
binning and the Brier decomposition, and document the bias rather than reporting a single
number as if it were ground truth (Kumar et al. 2019; Nixon et al. 2019).

References
──────────
  • Brier G.W. (1950) Verification of forecasts expressed in terms of probability.
    Monthly Weather Review 78:1.
  • Murphy A.H. (1973) A new vector partition of the probability score. J. Appl.
    Meteorol. 12:595.  (reliability / resolution / uncertainty decomposition)
  • Zadrozny B., Elkan C. (2002) Transforming classifier scores into accurate
    multiclass probability estimates. KDD.  (isotonic calibration)
  • Naeini M.P., Cooper G., Hauskrecht M. (2015) Obtaining well calibrated
    probabilities using Bayesian binning. AAAI.  (ECE)
  • Guo C. et al. (2017) On calibration of modern neural networks. ICML.
    (temperature scaling; reliability diagrams)
  • Nixon J. et al. (2019) Measuring calibration in deep learning. CVPRW.
    (adaptive / equal-mass binning; ECE pitfalls)
  • Kumar A., Liang P., Ma T. (2019) Verified uncertainty calibration. NeurIPS.
    (ECE is a biased estimator; debiasing)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np

__all__ = [
    "ReliabilityCurve",
    "reliability_curve",
    "expected_calibration_error",
    "maximum_calibration_error",
    "brier_score",
    "BrierDecomposition",
    "brier_decomposition",
    "calibration_in_the_large",
    "IsotonicCalibrator",
    "fit_temperature",
    "temperature_transform",
]


# --------------------------------------------------------------------------- #
# Input hygiene
# --------------------------------------------------------------------------- #


def _as_probs_labels(probs, labels) -> tuple[np.ndarray, np.ndarray]:
    p = np.asarray(probs, dtype=float).ravel()
    y = np.asarray(labels, dtype=float).ravel()
    if p.size == 0:
        raise ValueError("empty probability array")
    if p.size != y.size:
        raise ValueError(f"probs and labels length mismatch: {p.size} vs {y.size}")
    if not np.all(np.isfinite(p)):
        raise ValueError("non-finite probabilities")
    if p.min() < -1e-9 or p.max() > 1 + 1e-9:
        raise ValueError("probabilities must lie in [0, 1]")
    uy = np.unique(y)
    if not np.all(np.isin(uy, (0.0, 1.0))):
        raise ValueError(f"labels must be binary 0/1, got values {uy[:6]}")
    return np.clip(p, 0.0, 1.0), y


# --------------------------------------------------------------------------- #
# Reliability curve (the diagram behind a reliability diagram)
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class ReliabilityCurve:
    """Binned reliability data. A perfectly calibrated model has
    ``mean_predicted == empirical_frequency`` in every populated bin."""

    bin_edges: np.ndarray  # (n_bins+1,)
    mean_predicted: np.ndarray  # (n_bins,) mean p in each bin (nan if empty)
    empirical_frequency: np.ndarray  # (n_bins,) observed positive rate (nan if empty)
    counts: np.ndarray  # (n_bins,) points per bin
    strategy: str

    @property
    def gaps(self) -> np.ndarray:
        """Signed calibration gap (empirical - predicted) per populated bin."""
        return self.empirical_frequency - self.mean_predicted


def reliability_curve(
    probs,
    labels,
    n_bins: int = 10,
    strategy: Literal["uniform", "quantile"] = "uniform",
) -> ReliabilityCurve:
    """Bin predictions and compare mean predicted probability to observed frequency.

    strategy='uniform'  → equal-width bins on [0,1] (classic reliability diagram).
    strategy='quantile' → equal-mass bins (adaptive; each bin holds ~n/n_bins points).
                          Equal-mass avoids the sparsely-populated high-confidence bins
                          that make equal-width ECE noisy (Nixon 2019).
    """
    p, y = _as_probs_labels(probs, labels)
    if n_bins < 1:
        raise ValueError("n_bins must be >= 1")
    if strategy == "uniform":
        edges = np.linspace(0.0, 1.0, n_bins + 1)
    elif strategy == "quantile":
        qs = np.linspace(0.0, 1.0, n_bins + 1)
        edges = np.unique(np.quantile(p, qs))
        edges[0], edges[-1] = 0.0, 1.0
    else:
        raise ValueError("strategy must be 'uniform' or 'quantile'")

    nb = edges.size - 1
    idx = np.clip(np.digitize(p, edges[1:-1], right=False), 0, nb - 1)
    mean_pred = np.full(nb, np.nan)
    emp_freq = np.full(nb, np.nan)
    counts = np.zeros(nb, dtype=int)
    for b in range(nb):
        m = idx == b
        c = int(m.sum())
        counts[b] = c
        if c:
            mean_pred[b] = float(p[m].mean())
            emp_freq[b] = float(y[m].mean())
    return ReliabilityCurve(edges, mean_pred, emp_freq, counts, strategy)


def expected_calibration_error(
    probs,
    labels,
    n_bins: int = 15,
    strategy: Literal["uniform", "quantile"] = "uniform",
) -> float:
    """ECE — count-weighted mean |empirical - predicted| across bins (Naeini 2015).

    ECE is a *biased* estimator of true calibration error and depends on the binning;
    report it alongside :func:`brier_decomposition` and try both strategies rather than
    treating a single ECE as ground truth (Kumar 2019; Nixon 2019).
    """
    rc = reliability_curve(probs, labels, n_bins, strategy)
    pop = rc.counts > 0
    if not pop.any():
        return float("nan")
    w = rc.counts[pop] / rc.counts.sum()
    return float(np.sum(w * np.abs(rc.empirical_frequency[pop] - rc.mean_predicted[pop])))


def maximum_calibration_error(
    probs,
    labels,
    n_bins: int = 15,
    strategy: Literal["uniform", "quantile"] = "uniform",
) -> float:
    """MCE — worst-bin |empirical - predicted| (the safety-relevant tail, Naeini 2015)."""
    rc = reliability_curve(probs, labels, n_bins, strategy)
    pop = rc.counts > 0
    if not pop.any():
        return float("nan")
    return float(np.max(np.abs(rc.empirical_frequency[pop] - rc.mean_predicted[pop])))


# --------------------------------------------------------------------------- #
# Brier score + Murphy decomposition (binning-based reliability/resolution)
# --------------------------------------------------------------------------- #


def brier_score(probs, labels) -> float:
    """Mean squared error of probabilistic predictions (Brier 1950). Lower is better."""
    p, y = _as_probs_labels(probs, labels)
    return float(np.mean((p - y) ** 2))


@dataclass(frozen=True)
class BrierDecomposition:
    """Murphy (1973) three-term partition:  Brier = reliability - resolution + uncertainty.

    * reliability (↓ better): calibration error — how far bin frequencies sit from bin
      mean predictions. 0 = perfectly calibrated.
    * resolution (↑ better): how much bin frequencies deviate from the base rate — the
      useful discrimination the score carries.
    * uncertainty: base-rate variance p̄(1-p̄); a property of the data, not the model.
    """

    brier: float
    reliability: float
    resolution: float
    uncertainty: float
    n_bins_populated: int

    def reconstructed(self) -> float:
        return self.reliability - self.resolution + self.uncertainty


def brier_decomposition(
    probs, labels, n_bins: int = 15, strategy: Literal["uniform", "quantile"] = "quantile"
) -> BrierDecomposition:
    """Decompose the Brier score. Uses equal-mass bins by default (more stable)."""
    p, y = _as_probs_labels(probs, labels)
    rc = reliability_curve(p, y, n_bins, strategy)
    n = p.size
    base = float(y.mean())
    pop = rc.counts > 0
    nk = rc.counts[pop].astype(float)
    fk = rc.empirical_frequency[pop]
    ok = rc.mean_predicted[pop]
    reliability = float(np.sum(nk * (ok - fk) ** 2) / n)
    resolution = float(np.sum(nk * (fk - base) ** 2) / n)
    uncertainty = float(base * (1.0 - base))
    return BrierDecomposition(
        brier=brier_score(p, y),
        reliability=reliability,
        resolution=resolution,
        uncertainty=uncertainty,
        n_bins_populated=int(pop.sum()),
    )


def calibration_in_the_large(probs, labels) -> float:
    """Mean predicted probability minus the base rate. 0 = correct on average.

    A first, coarse global-bias check (Cox 1958): a model can be right on average yet
    badly calibrated per-bin, so use with the reliability curve, never alone.
    """
    p, y = _as_probs_labels(probs, labels)
    return float(p.mean() - y.mean())


# --------------------------------------------------------------------------- #
# Post-hoc calibrators
# --------------------------------------------------------------------------- #


def _pav(x: np.ndarray, y: np.ndarray, w: np.ndarray) -> np.ndarray:
    """Pool-Adjacent-Violators: isotonic (non-decreasing) fit of y on sorted x.

    Returns the fitted non-decreasing step values aligned to the x-sorted order.
    O(n) after the sort. This is the exact L2 isotonic regression solution.
    """
    n = x.size
    # value, weight, and the count of merged blocks, kept as parallel stacks
    vals = y.astype(float).copy()
    wts = w.astype(float).copy()
    idx_end = np.arange(n)  # rightmost original index covered by each active block
    # iterative pooling
    level_val: list[float] = []
    level_w: list[float] = []
    level_end: list[int] = []
    for i in range(n):
        v, wi, e = vals[i], wts[i], idx_end[i]
        while level_val and level_val[-1] >= v:
            # violation: merge previous block into current
            pv, pw = level_val.pop(), level_w.pop()
            pe = level_end.pop()
            v = (v * wi + pv * pw) / (wi + pw)
            wi = wi + pw
            e = max(e, pe)
        level_val.append(v)
        level_w.append(wi)
        level_end.append(e)
    # expand block values back to per-point fitted values
    fitted = np.empty(n, dtype=float)
    start = 0
    for v, e in zip(level_val, level_end):
        fitted[start : e + 1] = v
        start = e + 1
    return fitted


@dataclass
class IsotonicCalibrator:
    """Monotone (isotonic) probability calibrator via Pool-Adjacent-Violators.

    Non-parametric: learns an arbitrary non-decreasing map score→probability from a
    held-out calibration sample. More flexible than Platt/temperature (no sigmoid shape
    assumption), at the cost of needing more calibration points and piecewise-constant
    outputs. Fit on data the model did NOT train on (Zadrozny & Elkan 2002).

    Calling ``transform`` before ``fit`` raises — it never invents a mapping.
    """

    x_thresholds: np.ndarray | None = None  # sorted unique score breakpoints
    y_values: np.ndarray | None = None  # calibrated prob at each breakpoint
    n_fit: int = 0

    def fit(self, scores, labels) -> IsotonicCalibrator:
        s = np.asarray(scores, dtype=float).ravel()
        y = np.asarray(labels, dtype=float).ravel()
        if s.size != y.size:
            raise ValueError("scores and labels length mismatch")
        if s.size < 2:
            raise ValueError("need >= 2 calibration points")
        if not np.all(np.isfinite(s)):
            raise ValueError("non-finite scores")
        if not np.all(np.isin(np.unique(y), (0.0, 1.0))):
            raise ValueError("labels must be binary 0/1")
        order = np.argsort(s, kind="mergesort")
        s_sorted = s[order]
        y_sorted = y[order]
        w = np.ones_like(s_sorted)
        fitted = _pav(s_sorted, y_sorted, w)
        # collapse to unique score breakpoints (keep the last fitted value per score)
        uniq, last_idx = np.unique(s_sorted, return_index=False, return_inverse=False), None
        xs, ys = [], []
        i = 0
        m = s_sorted.size
        while i < m:
            j = i
            while j + 1 < m and s_sorted[j + 1] == s_sorted[i]:
                j += 1
            xs.append(float(s_sorted[i]))
            ys.append(float(fitted[j]))  # fitted is constant within a tie block
            i = j + 1
        self.x_thresholds = np.asarray(xs, dtype=float)
        self.y_values = np.clip(np.asarray(ys, dtype=float), 0.0, 1.0)
        self.n_fit = int(s.size)
        return self

    def transform(self, scores) -> np.ndarray:
        if self.x_thresholds is None or self.y_values is None:
            raise RuntimeError("IsotonicCalibrator must be fit before transform")
        s = np.asarray(scores, dtype=float).ravel()
        if not np.all(np.isfinite(s)):
            raise ValueError("non-finite scores")
        # piecewise-constant / linear interpolation between breakpoints, clamped at ends
        return np.interp(
            s, self.x_thresholds, self.y_values, left=self.y_values[0], right=self.y_values[-1]
        )


def temperature_transform(probs, temperature: float) -> np.ndarray:
    """Apply temperature scaling to probabilities: sigmoid(logit(p)/T) (Guo 2017)."""
    if temperature <= 0 or not np.isfinite(temperature):
        raise ValueError("temperature must be positive and finite")
    p = np.clip(np.asarray(probs, dtype=float).ravel(), 1e-7, 1 - 1e-7)
    logits = np.log(p / (1.0 - p))
    return 1.0 / (1.0 + np.exp(-logits / temperature))


def fit_temperature(probs, labels, grid: int = 200) -> float:
    """Fit a single temperature T minimising negative log-likelihood (Guo 2017).

    One-parameter, monotone (preserves ranking/AUC), ideal when a model is
    over/under-confident but its ordering is good. Pure-numpy grid + local refine.
    """
    p, y = _as_probs_labels(probs, labels)
    p = np.clip(p, 1e-7, 1 - 1e-7)
    logits = np.log(p / (1.0 - p))

    def nll(T: float) -> float:
        if T <= 0:
            return float("inf")
        q = 1.0 / (1.0 + np.exp(-logits / T))
        q = np.clip(q, 1e-9, 1 - 1e-9)
        return float(-np.mean(y * np.log(q) + (1 - y) * np.log(1 - q)))

    coarse = np.linspace(0.2, 6.0, grid)
    best = float(min(coarse, key=nll))
    fine = np.linspace(max(0.05, best - 0.1), best + 0.1, 81)
    return float(min(fine, key=nll))
