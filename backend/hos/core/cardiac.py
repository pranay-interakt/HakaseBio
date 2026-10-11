"""QT interval correction and within-animal change summaries for in vivo QT studies.

Corrections (QT and RR in milliseconds unless stated):

* Fridericia: QTc = QT / RR^(1/3), RR in seconds (Fridericia 1920; stated in Vandenberk et al.
  2016).
* Bazett: QTc = QT / RR^(1/2), RR in seconds (as stated in Vandenberk et al. 2016; the 1920 paper
  could not be read, and the corrected-QT form is attributed to Taran and Szilagyi 1947, Cobos Gil
  2008).
* Van de Water: QTc = QT - 0.087 (RR - 1000), RR in ms (Van de Water et al. 1989, abstract;
  derived in anaesthetised dogs).
* Individual: QTc = QT - b (RR - RR_ref), with b the least-squares slope of the animal's own QT on
  RR (S7B Q&A 3.3 prefers individual correction when the drug affects heart rate; the RR-linear
  form as in Chui et al. 2021 and Engwall et al. 2023). RR_ref is a stated input.

S7B section 3.1.3: the choice of correction "should be justified with data from the test
system"; S7B Q&A 3.3: show the independence of QTc from RR with the number of matched pairs, a
correlation metric, 95% confidence intervals and p-values (:func:`rr_independence`).

Changes from baseline and from vehicle are summarised by the mean, a 95% confidence interval and
a two-sided p-value from Student's t distribution (Student 1908) (:func:`t_summary`).
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

import numpy as np
from scipy import stats

__all__ = ["Correction", "RRIndependence", "TSummary", "correct_qt", "individual_slope",
           "rr_independence", "t_summary"]

Correction = Literal["individual", "fridericia", "bazett", "van_de_water"]


def correct_qt(qt_ms: float, rr_ms: float, method: Correction, *, slope: float | None = None,
               rr_ref_ms: float | None = None) -> float:
    """QTc in ms."""
    if qt_ms <= 0 or rr_ms <= 0:
        raise ValueError("QT and RR must be positive")
    if method == "fridericia":
        return float(qt_ms / (rr_ms / 1000.0) ** (1.0 / 3.0))
    if method == "bazett":
        return qt_ms / math.sqrt(rr_ms / 1000.0)
    if method == "van_de_water":
        return qt_ms - 0.087 * (rr_ms - 1000.0)
    if slope is None or rr_ref_ms is None:
        raise ValueError("individual correction needs the animal's slope and the reference RR")
    return qt_ms - slope * (rr_ms - rr_ref_ms)


def individual_slope(qt_ms: Sequence[float], rr_ms: Sequence[float]) -> float:
    """Least-squares slope of QT on RR for one animal."""
    x, y = np.asarray(rr_ms, dtype=float), np.asarray(qt_ms, dtype=float)
    if len(x) < 3 or float(np.ptp(x)) == 0:
        raise ValueError("an individual QT-RR slope needs at least 3 pairs over a range of RR")
    return float(np.polyfit(x, y, 1)[0])


@dataclass(frozen=True, slots=True)
class RRIndependence:
    n_pairs: int
    slope: float          # ms QTc per ms RR
    slope_ci: tuple[float, float]
    r: float
    p_value: float


def rr_independence(qtc_ms: Sequence[float], rr_ms: Sequence[float]) -> RRIndependence:
    """Regression of QTc on RR: slope with 95% CI, Pearson r and the slope's p-value."""
    x, y = np.asarray(rr_ms, dtype=float), np.asarray(qtc_ms, dtype=float)
    if len(x) < 3:
        raise ValueError("at least 3 matched QTc-RR pairs are needed")
    res = stats.linregress(x, y)
    t = float(stats.t.ppf(0.975, len(x) - 2))
    return RRIndependence(len(x), float(res.slope),
                          (float(res.slope - t * res.stderr), float(res.slope + t * res.stderr)),
                          float(res.rvalue), float(res.pvalue))


@dataclass(frozen=True, slots=True)
class TSummary:
    n: int
    mean: float
    sd: float | None
    ci: tuple[float, float] | None
    p_value: float | None


def t_summary(values: Sequence[float]) -> TSummary:
    """Mean with a 95% confidence interval and the two-sided p-value for mean = 0 (Student)."""
    v = np.asarray(values, dtype=float)
    n = len(v)
    if n == 0:
        raise ValueError("no values")
    mean = float(np.mean(v))
    if n < 2:
        return TSummary(n, mean, None, None, None)
    sd = float(np.std(v, ddof=1))
    se = sd / math.sqrt(n)
    t = float(stats.t.ppf(0.975, n - 1))
    if se == 0:
        return TSummary(n, mean, sd, (mean, mean), None if mean == 0 else 0.0)
    p = float(2 * stats.t.sf(abs(mean / se), n - 1))
    return TSummary(n, mean, sd, (mean - t * se, mean + t * se), p)
