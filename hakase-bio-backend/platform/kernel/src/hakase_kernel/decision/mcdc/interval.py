"""Credal (interval) probability primitives.

A *credal interval* ``[lo, hi]`` on ``[0, 1]`` represents an imprecise probability:
the true activation probability of a biological key event is known only to lie in
``[lo, hi]``. The interval *midpoint* carries the best point estimate (absorbing
irreducible / aleatoric assay noise); the interval *width* carries reducible /
epistemic ignorance (out-of-domain distance and inter-source conflict).

This separation is enforced by construction rather than learned, which is the
reason it does not collapse out-of-distribution the way learned aleatoric
uncertainty heads do.

All operations are total and validated; there are no silent fallbacks. Invalid
inputs raise ``ValueError`` immediately.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

_EPS = 1e-12


@dataclass(frozen=True)
class Interval:
    """A closed sub-interval of ``[0, 1]`` with ``lo <= hi``."""

    lo: float
    hi: float

    def __post_init__(self) -> None:
        if not np.isfinite(self.lo) or not np.isfinite(self.hi):
            raise ValueError(f"Interval bounds must be finite, got [{self.lo}, {self.hi}]")
        if self.lo < -_EPS or self.hi > 1.0 + _EPS:
            raise ValueError(f"Interval must lie in [0, 1], got [{self.lo}, {self.hi}]")
        if self.lo > self.hi + _EPS:
            raise ValueError(f"Interval requires lo <= hi, got [{self.lo}, {self.hi}]")

    @property
    def width(self) -> float:
        """Epistemic width of the interval."""
        return float(self.hi - self.lo)

    @property
    def mid(self) -> float:
        """Best point estimate (interval midpoint)."""
        return float(0.5 * (self.lo + self.hi))

    def overlaps(self, other: Interval) -> bool:
        return (self.lo <= other.hi + _EPS) and (other.lo <= self.hi + _EPS)

    def as_tuple(self) -> tuple[float, float]:
        return (self.lo, self.hi)


def clamp01(value: float) -> float:
    """Project a scalar onto ``[0, 1]``."""
    return float(min(1.0, max(0.0, value)))


def point_with_halfwidth(center: float, half_width: float) -> Interval:
    """Build an interval ``[center - h, center + h]`` clamped to ``[0, 1]``.

    ``half_width`` must be non-negative; a negative value indicates a caller bug
    and is rejected rather than silently corrected.
    """
    if half_width < -_EPS:
        raise ValueError(f"half_width must be non-negative, got {half_width}")
    h = max(0.0, half_width)
    return Interval(clamp01(center - h), clamp01(center + h))


def intersect(a: Interval, b: Interval) -> Interval | None:
    """Return the intersection of two intervals, or ``None`` if disjoint."""
    lo = max(a.lo, b.lo)
    hi = min(a.hi, b.hi)
    if lo > hi + _EPS:
        return None
    return Interval(lo, min(hi, 1.0) if hi <= lo else hi if hi >= lo else lo)


def hull(a: Interval, b: Interval) -> Interval:
    """Return the convex hull (union enclosure) of two intervals."""
    return Interval(min(a.lo, b.lo), max(a.hi, b.hi))


def combine_consensus(intervals: list[Interval]) -> Interval:
    """Fuse several credal observations of the *same* latent key event.

    Fusion rule (the calibrated cure for the Dempster--Shafer conflict pathology):

    * If the intervals are mutually consistent (their intersection is non-empty),
      return the intersection -- agreeing evidence *narrows* belief.
    * If they conflict (empty intersection), return the convex hull -- conflicting
      evidence *widens* belief toward honest ignorance instead of concentrating
      belief on a spurious hypothesis, which is exactly what Dempster's rule of
      combination does wrong under conflict.

    This function is order-independent and total.
    """
    if not intervals:
        raise ValueError("combine_consensus requires at least one interval")
    lo_int = max(iv.lo for iv in intervals)
    hi_int = min(iv.hi for iv in intervals)
    if lo_int <= hi_int + _EPS:
        # Consistent: intersection.
        return Interval(lo_int, max(lo_int, hi_int))
    # Conflicting: convex hull (widen).
    return Interval(min(iv.lo for iv in intervals), max(iv.hi for iv in intervals))
