"""Calibrated reliability — a defensible replacement for heuristic confidence maps.

THE PROBLEM THIS FIXES
──────────────────────
Hakase's in-vitro panel currently turns an ensemble's disagreement into a
"confidence" and a "High/Medium/Low reliability" band through a hand-picked constant::

    classifier_confidence(std) = 1 - std / 0.35      # models/uncertainty.py
    regressor_confidence(mean, std) = 1 - (std/|mean|) / 0.5

The dispersion signal (ensemble std) is real and useful, but the map to a [0,1]
"confidence" is arbitrary: there is no evidence that "confidence 0.72" means the
prediction is correct 72% of the time. That is precisely the kind of unjustifiable
number the platform should not show a scientist.

THE FIX
───────
``CalibratedReliability`` learns the map from a dispersion / margin / nonconformity
signal to the *empirical probability the prediction is correct*, on a held-out labelled
sample, using isotonic regression (monotone, non-parametric — it assumes only that more
disagreement never means more reliable, which is the one thing we actually believe). The
output is then a genuine probability of correctness, and its own calibration is
measurable with :mod:`reasoning.calibration`.

Crucially, when no calibration sample is available it does **not** fall back to a
heuristic — it returns ``None`` with an explicit reason. "We cannot certify a reliability
here" is a valid, first-class answer, matching the abstain-by-default posture of the rest
of the stack.

References
──────────
  • Zadrozny B., Elkan C. (2002) Transforming classifier scores into accurate
    probability estimates. KDD.  (isotonic calibration)
  • Platt J. (1999) Probabilistic outputs for SVMs.  (sigmoid calibration; alt shape)
  • Guo C. et al. (2017) On calibration of modern neural networks. ICML.
  • Kompa B., Snoek J., Beam A. (2021) Second opinion needed: communicating
    uncertainty in medical ML. npj Digital Medicine.  (why honest UQ matters clinically)
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .calibration import IsotonicCalibrator, expected_calibration_error

__all__ = ["ReliabilityEstimate", "CalibratedReliability", "audit_heuristic_confidence"]


@dataclass(frozen=True)
class ReliabilityEstimate:
    """A per-prediction reliability with its scientific basis (or an honest abstention)."""

    value: float | None  # calibrated P(correct) in [0,1], or None if not estimable
    band: str | None  # 'High' | 'Medium' | 'Low' | None
    estimable: bool
    basis: str  # human-readable justification
    in_calibration_range: bool | None = None  # was the signal within the fitted range?

    def as_dict(self) -> dict:
        return {
            "reliability": None if self.value is None else round(self.value, 4),
            "band": self.band,
            "estimable": self.estimable,
            "in_calibration_range": self.in_calibration_range,
            "basis": self.basis,
        }


def _band(p: float) -> str:
    # Bands are reported on a genuine probability-of-correctness, so the cutpoints have a
    # concrete meaning (chance of being right), unlike the heuristic's arbitrary scale.
    if p >= 0.85:
        return "High"
    if p >= 0.6:
        return "Medium"
    return "Low"


@dataclass
class CalibratedReliability:
    """Map an uncertainty signal to a calibrated probability that a prediction is correct.

    Parameters
    ----------
    higher_is_better:
        Orientation of the input signal. For a *margin* (e.g. |p-0.5|, or 1/std) higher
        means more reliable → True. For a *dispersion / nonconformity* (ensemble std,
        distance) higher means less reliable → False.

    Fit with ``fit(signal, correct)`` where ``correct`` is 1 if the corresponding
    prediction was right on the held-out set, else 0. Then ``estimate(signal)`` returns a
    :class:`ReliabilityEstimate` carrying a calibrated P(correct) — or an explicit
    not-estimable when unfit.
    """

    higher_is_better: bool = True
    min_fit: int = 50  # below this, an isotonic reliability is too noisy to certify
    _iso: IsotonicCalibrator | None = field(default=None, repr=False)
    _lo: float = field(default=np.nan, repr=False)
    _hi: float = field(default=np.nan, repr=False)
    _self_ece: float = field(default=np.nan, repr=False)
    _n_fit: int = 0

    def _orient(self, s: np.ndarray) -> np.ndarray:
        # Isotonic learns a non-decreasing map; orient so that larger oriented signal
        # ⇒ more reliable, regardless of the raw signal's direction.
        return s if self.higher_is_better else -s

    def fit(self, signal, correct) -> CalibratedReliability:
        s = np.asarray(signal, dtype=float).ravel()
        c = np.asarray(correct, dtype=float).ravel()
        if s.size != c.size:
            raise ValueError("signal and correct length mismatch")
        if s.size < self.min_fit:
            raise ValueError(
                f"need >= {self.min_fit} labelled points to certify a reliability map, "
                f"got {s.size}; abstain instead of fitting a noisy map"
            )
        finite = np.isfinite(s)
        s, c = s[finite], c[finite]
        if not np.all(np.isin(np.unique(c), (0.0, 1.0))):
            raise ValueError("`correct` must be binary 0/1 (was the prediction right?)")
        if np.unique(c).size < 2:
            raise ValueError("`correct` has a single class; cannot fit a reliability map")
        self._lo, self._hi = float(s.min()), float(s.max())
        oriented = self._orient(s)
        self._iso = IsotonicCalibrator().fit(oriented, c)
        # self-calibration quality of the fitted reliability (in-sample floor; the harness
        # measures it out-of-sample). Reported so a consumer can judge the map itself.
        fitted = self._iso.transform(oriented)
        try:
            self._self_ece = expected_calibration_error(fitted, c, n_bins=10, strategy="quantile")
        except Exception:
            self._self_ece = float("nan")
        self._n_fit = int(s.size)
        return self

    @property
    def self_ece(self) -> float:
        return self._self_ece

    def estimate(self, signal_value: float) -> ReliabilityEstimate:
        """Calibrated P(correct) for one prediction's uncertainty signal."""
        if self._iso is None:
            return ReliabilityEstimate(
                None,
                None,
                False,
                "reliability not estimable: no held-out calibration sample was provided "
                "for this endpoint. Refusing to emit a heuristic confidence number.",
            )
        s = float(signal_value)
        if not np.isfinite(s):
            return ReliabilityEstimate(
                None, None, False, "reliability not estimable: signal is non-finite."
            )
        in_range = bool(self._lo <= s <= self._hi)
        p = float(self._iso.transform([self._orient(np.array([s]))[0]])[0])
        basis = (
            f"isotonic calibration of the uncertainty signal against held-out "
            f"correctness (n={self._n_fit}, self-ECE={self._self_ece:.3f}); "
            f"reported as a probability the prediction is correct."
        )
        if not in_range:
            basis += (
                " NOTE: signal is outside the calibrated range — value is clamped "
                "extrapolation, treat as indicative only."
            )
        return ReliabilityEstimate(p, _band(p), True, basis, in_range)


def audit_heuristic_confidence(heuristic_conf, correct, n_bins: int = 10) -> dict:
    """Measure how (mis)calibrated an existing heuristic 'confidence' actually is.

    Takes the confidence numbers a heuristic already produced and the realised
    correctness, and returns the ECE / mean-confidence-vs-accuracy gap — the evidence
    for whether a shown 'confidence: High' is trustworthy. Used by the audit harness.
    """
    conf = np.asarray(heuristic_conf, dtype=float).ravel()
    c = np.asarray(correct, dtype=float).ravel()
    if conf.size != c.size:
        raise ValueError("length mismatch")
    conf = np.clip(conf, 0.0, 1.0)
    ece = expected_calibration_error(conf, c, n_bins=n_bins, strategy="uniform")
    return {
        "ece": round(float(ece), 4),
        "mean_confidence": round(float(conf.mean()), 4),
        "empirical_accuracy": round(float(c.mean()), 4),
        "overconfidence_gap": round(float(conf.mean() - c.mean()), 4),
        "n": int(conf.size),
        "interpretation": (
            "mean stated confidence minus realised accuracy; a large "
            "positive gap means the heuristic systematically overstates how "
            "reliable predictions are."
        ),
    }
