"""Conformal prediction — distribution-free uncertainty quantification.

WHY THIS EXISTS
───────────────
The L1 verdict needs two things that raw ML point-predictions cannot provide:

  1. CALIBRATED INTERVALS on numeric ADMET endpoints — "Caco-2 18 ×10⁻⁶ cm/s,
     90% CI [9, 32]" with a *coverage guarantee*, not a single number.
  2. AN FPR-CONTROLLED VETO THRESHOLD — a hard-stop gate whose false-positive
     rate on a held-out approved-drug set is provably ≤ α, instead of a
     hand-picked 0.92.

Both are delivered by split-conformal prediction (Vovk; Lei et al. 2018), which
gives FINITE-SAMPLE, DISTRIBUTION-FREE marginal coverage under the single
assumption of exchangeability of calibration and test points. No parametric
model of the error is assumed; the guarantee is exact.

This module is pure numpy — no fabricated constants, no hidden fallbacks. Every
output is derived from a real calibration sample the caller supplies (model
predictions vs measured truth). With too few calibration points to support the
requested confidence, the interval is reported as infinite / the gate abstains
(never flags) — the conservative, honest direction.

References
──────────
  • Vovk, Gammerman, Shafer (2005) Algorithmic Learning in a Random World.
  • Lei, G'Sell, Rinaldo, Tibshirani, Wasserman (2018) Distribution-Free
    Predictive Inference for Regression. JASA 113:1094.
  • Romano, Patterson, Candès (2019) Conformalized Quantile Regression. NeurIPS.
  • Vovk (2012) Conditional validity of inductive conformal predictors (Mondrian).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np


def _as1d(x) -> np.ndarray:
    a = np.asarray(x, dtype=float).ravel()
    if a.size == 0:
        raise ValueError("empty array")
    if not np.all(np.isfinite(a)):
        raise ValueError("non-finite values in conformal input")
    return a


def conformal_quantile(scores: np.ndarray, alpha: float) -> float:
    """The split-conformal (1-α) quantile of nonconformity `scores`.

    Uses the finite-sample correction level ⌈(n+1)(1-α)⌉ / n (Lei 2018). When
    that level exceeds 1 (too few points for the requested α) returns +inf — the
    honest "cannot certify this confidence yet" signal.
    """
    s = np.sort(_as1d(scores))
    n = s.size
    if not (0.0 < alpha < 1.0):
        raise ValueError("alpha must be in (0,1)")
    rank = int(np.ceil((n + 1) * (1.0 - alpha)))
    if rank > n:
        return float("inf")
    return float(s[rank - 1])  # rank is 1-indexed


# ─────────────────────────────────────────────────────────────────────────────
# Split-conformal regression (optionally locally-normalized / Mondrian).
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class ConformalRegressor:
    """Split-conformal regressor. Calibrate on (prediction, truth) pairs from a
    held-out set the model never trained on, then wrap any new point estimate in
    an interval with guaranteed marginal coverage ≥ 1-α.

    If per-point uncertainty estimates `sigma` are supplied at calibration AND
    prediction time, intervals are locally adaptive (normalized conformal):
    width scales with the model's own uncertainty, tightening where the model is
    confident and widening where it is not — while preserving marginal coverage.
    """
    abs_residuals: np.ndarray = field(default_factory=lambda: np.empty(0))
    n_cal: int = 0
    normalized: bool = False

    def calibrate(self, cal_pred, cal_true, sigma=None) -> "ConformalRegressor":
        p = _as1d(cal_pred)
        y = _as1d(cal_true)
        if p.size != y.size:
            raise ValueError("cal_pred and cal_true length mismatch")
        resid = np.abs(y - p)
        if sigma is not None:
            s = _as1d(sigma)
            if s.size != p.size:
                raise ValueError("sigma length mismatch")
            if np.any(s <= 0):
                raise ValueError("sigma must be strictly positive")
            resid = resid / s
            self.normalized = True
        self.abs_residuals = resid
        self.n_cal = resid.size
        return self

    def interval(self, pred: float, alpha: float = 0.1, sigma: Optional[float] = None) -> tuple[float, float]:
        if self.n_cal == 0:
            raise RuntimeError("calibrate() before interval()")
        q = conformal_quantile(self.abs_residuals, alpha)
        if self.normalized:
            if sigma is None or sigma <= 0:
                raise ValueError("normalized model requires a positive sigma at prediction time")
            q = q * sigma
        return (float(pred - q), float(pred + q))


@dataclass
class MondrianConformalRegressor:
    """Group-conditional (Mondrian) conformal regression. Separate calibration
    quantiles per group label (e.g. applicability-domain bin: in/border/out, or
    chemotype) → coverage holds *within each group*, not just marginally. This is
    what makes "in-domain predictions are tighter than out-of-domain" honest and
    guaranteed rather than asserted.
    """
    by_group: dict = field(default_factory=dict)

    def calibrate(self, cal_pred, cal_true, groups) -> "MondrianConformalRegressor":
        p = _as1d(cal_pred); y = _as1d(cal_true)
        g = np.asarray(groups).ravel()
        if not (p.size == y.size == g.size):
            raise ValueError("length mismatch")
        resid = np.abs(y - p)
        self.by_group = {}
        for grp in np.unique(g):
            self.by_group[grp] = resid[g == grp]
        return self

    def interval(self, pred: float, group, alpha: float = 0.1) -> tuple[float, float]:
        r = self.by_group.get(group)
        if r is None or r.size == 0:
            return (float("-inf"), float("inf"))  # unseen group → cannot certify
        q = conformal_quantile(r, alpha)
        return (float(pred - q), float(pred + q))


# ─────────────────────────────────────────────────────────────────────────────
# FPR-controlled conformal veto gate (one-sided, Mondrian on the negative class).
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class ConformalVetoGate:
    """A hard-veto threshold whose false-positive rate on the NEGATIVE class
    (e.g. approved drugs that should NOT be vetoed) is provably ≤ α.

    Calibrate on the predicted liability scores of a held-out NEGATIVE set. The
    threshold is the conformal (1-α) quantile of those negative scores, so by
    exchangeability the probability a new negative exceeds it is ≤ α — i.e. the
    veto's FPR on approved drugs is controlled by construction, not tuned by
    hand. This is the principled replacement for the magic 0.92 hERG threshold.

    `flag(score)` fires the veto iff score > threshold (STRICT — this is what makes
    P(flag | negative) ≤ α hold even when scores are tied; using ≥ can violate the
    guarantee under heavy ties). With too few calibration negatives for the
    requested α, the threshold is +inf and the gate NEVER flags (FPR = 0 ≤ α) —
    fail-safe, never a false stop.
    """
    threshold: float = float("inf")
    alpha: float = 0.05
    n_cal_negatives: int = 0

    def calibrate(self, negative_scores, alpha: float = 0.05) -> "ConformalVetoGate":
        s = _as1d(negative_scores)
        self.alpha = float(alpha)
        self.n_cal_negatives = s.size
        # Threshold = (1-α) conformal quantile of negative scores. P(neg > t) ≤ α.
        self.threshold = conformal_quantile(s, alpha)
        return self

    def flag(self, score: float) -> bool:
        return bool(np.isfinite(self.threshold) and score > self.threshold)


# ─────────────────────────────────────────────────────────────────────────────
# Empirical verification helpers (used by the validation harness + unit tests).
# ─────────────────────────────────────────────────────────────────────────────
def empirical_coverage(lowers, uppers, y_true) -> float:
    lo = _as1d(lowers); hi = _as1d(uppers); y = _as1d(y_true)
    if not (lo.size == hi.size == y.size):
        raise ValueError("length mismatch")
    return float(np.mean((y >= lo) & (y <= hi)))


def empirical_fpr(scores, threshold: float) -> float:
    """Fraction of (negative-class) scores ABOVE the veto threshold — matches the
    gate's strict-`>` flagging rule, so the reported FPR equals what the gate does."""
    s = _as1d(scores)
    if not np.isfinite(threshold):
        return 0.0
    return float(np.mean(s > threshold))
