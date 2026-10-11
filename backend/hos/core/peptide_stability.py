"""Peptide stability in blood, serum or plasma: depletion of the intact parent over time.

The primary papers (Böttger et al. 2017; Cavaco et al. 2021; Nguyen et al. 2010) incubate the
peptide in the matrix at a stated temperature, quench samples at stated times and express the
intact parent as a percentage of the time-zero sample by peak integration. Cavaco et al. 2021
estimate t1/2 with a one-phase exponential decay fit and report 95% confidence intervals.

Two models, chosen by the protocol (no default):

* **first order** (``peptide.first_order_decay``): ln(percent remaining) = a - k t by least
  squares, k = -slope, t1/2 = ln(2)/k (Obach 1999). The 95% interval of k is the slope's
  t-interval on n - 2 degrees of freedom (Student 1908); t1/2 = ln(2)/k is monotone, so its
  interval is [ln(2)/k_upper, ln(2)/k_lower].
* **one-phase decay** (``peptide.one_phase_decay``): Y = (Y0 - Plateau) exp(-K t) + Plateau,
  t1/2 = ln(2)/K (GraphPad Prism 11 curve-fitting guide), by nonlinear least squares with
  intervals from the asymptotic covariance and the t distribution on n - 3 degrees of freedom.

The first-order model is the one-phase model with the plateau fixed at zero. Under it, the
one-phase model is also fitted as a check: a plateau whose 95% interval lies above zero means
the peptide is not fully degraded, which the first-order half-life would hide.

A half-life longer than the last sampling time is an extrapolation (Böttger et al. 2017 report
peptides with more than 96% remaining at the last sample) and is not reported; the percentage
remaining at the last sample is reported instead.

Times are in minutes; responses are percentages of time zero.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
import scipy
from scipy import stats
from scipy.optimize import curve_fit

from hos.core.methods import method
from hos.core.provenance import Uncertainty
from hos.core.qc import QCFinding, QCStatus, QCVerdict
from hos.core.quantity import Quantity

__all__ = ["DecayFit", "DecayModel", "fit_decay", "percent_of_time_zero"]

DecayModel = Literal["first_order", "one_phase_decay"]
_SOFTWARE = {"numpy": np.__version__, "scipy": scipy.__version__}


def percent_of_time_zero(points: Mapping[float, float | None]) -> dict[float, float]:
    """One replicate's responses by time -> percent of its time-zero response.

    ``None`` marks a sample below the quantitation limit; it is left out, not imputed.
    """
    t0 = points.get(0.0)
    if t0 is None or t0 <= 0:
        raise ValueError("a quantifiable time-zero sample is needed to normalise a replicate")
    return {t: 100.0 * v / t0 for t, v in sorted(points.items()) if v is not None}


@dataclass(frozen=True, slots=True)
class DecayFit:
    model: DecayModel
    k: Quantity
    half_life: Quantity
    plateau: Quantity | None
    n_points: int
    last_time_min: float
    r_squared: float | None
    censored: bool
    qc: QCVerdict

    def to_dict(self) -> dict[str, Any]:
        return {"model": self.model, "k": self.k.to_dict(), "half_life": self.half_life.to_dict(),
                "plateau": self.plateau.to_dict() if self.plateau else None,
                "n_points": self.n_points, "last_time_min": self.last_time_min,
                "r_squared": self.r_squared, "censored": self.censored,
                "qc": self.qc.to_dict()}


def _one_phase(t: np.ndarray, y0: float, plateau: float, k: float) -> np.ndarray:
    return (y0 - plateau) * np.exp(-k * t) + plateau


def _fit_one_phase(t: np.ndarray, y: np.ndarray, k_start: float
                   ) -> tuple[np.ndarray, np.ndarray, float] | None:
    """Parameters (Y0, Plateau, K), their 95% half-widths and R^2; None if not estimable."""
    if len(t) < 4 or len(set(t.tolist())) < 3:
        return None
    try:
        popt, pcov = curve_fit(_one_phase, t, y, p0=[float(np.max(y)), float(np.min(y)),
                                                     max(k_start, 1e-6)],
                               bounds=([0.0, -np.inf, 0.0], [np.inf, np.inf, np.inf]),
                               maxfev=20000)
    except (RuntimeError, ValueError):
        return None
    if pcov is None or not np.all(np.isfinite(pcov)):
        return None
    tq = float(stats.t.ppf(0.975, len(t) - 3))
    half = tq * np.sqrt(np.diag(pcov))
    resid = y - _one_phase(t, *popt)
    ss_tot = float(np.sum((y - np.mean(y)) ** 2))
    r2 = 1.0 - float(np.sum(resid ** 2)) / ss_tot if ss_tot > 0 else float("nan")
    return popt, half, r2


def fit_decay(times: Sequence[float], percents: Sequence[float], *, model: DecayModel,
              min_r2: float, min_depletion_pct: float, label: str) -> DecayFit:
    """Fit pooled (time, percent of time zero) points with the protocol's model.

    ``min_r2`` and ``min_depletion_pct`` are run-acceptance criteria the protocol states with
    their basis; no source fixes them.
    """
    t = np.asarray(times, dtype=float)
    y = np.asarray(percents, dtype=float)
    if len(t) != len(y) or len(t) == 0:
        raise ValueError("times and percents must be non-empty and the same length")
    if np.any(t < 0) or np.any(y <= 0):
        raise ValueError("times are non-negative and quantifiable percentages positive")
    t_last = float(np.max(t))
    findings: list[QCFinding] = []
    m = method("peptide.first_order_decay" if model == "first_order"
               else "peptide.one_phase_decay")
    last_mean = float(np.mean(y[t == t_last]))
    depletion = 100.0 - last_mean
    if depletion < min_depletion_pct:
        findings.append(QCFinding(
            f"{label}.insufficient_depletion", QCStatus.WARN,
            f"{label}: {depletion:.1f}% depleted by {t_last:g} min, below the stated "
            f"{min_depletion_pct:g}%; the rate is poorly determined",
            observed=round(depletion, 2), threshold=min_depletion_pct))

    reg = stats.linregress(t, np.log(y)) if len(set(t.tolist())) >= 2 else None
    k_lin = -float(reg.slope) if reg is not None else 0.0
    plateau_q: Quantity | None = None
    plateau_check: QCFinding | None = None
    k_hat: float | None = None
    k_ci: tuple[float, float] | None = None
    r2: float | None = None

    if model == "first_order":
        if reg is None or len(t) < 3:
            return _unavailable(model, label, len(t), t_last, findings, plateau_q,
                                "fewer than three observations at two or more times")
        k_hat, r2 = k_lin, float(reg.rvalue ** 2)
        tq = float(stats.t.ppf(0.975, len(t) - 2))
        k_ci = (k_hat - tq * float(reg.stderr), k_hat + tq * float(reg.stderr))
        # the plateau check concerns a reported half-life, so it is added on that path only
        check = _fit_one_phase(t, y, k_lin)
        if check is None:
            plateau_check = QCFinding(
                f"{label}.plateau_unchecked", QCStatus.WARN,
                f"{label}: the one-phase decay check needs at least four observations at "
                "three or more times; incomplete degradation could not be checked")
        elif check[0][1] - check[1][1] > 0:
            p, h = float(check[0][1]), float(check[1][1])
            plateau_check = QCFinding(
                f"{label}.incomplete_degradation", QCStatus.WARN,
                f"{label}: the one-phase decay plateau is {p:.1f}% (95% CI {p - h:.1f} to "
                f"{p + h:.1f}), above zero; part of the peptide is not degraded and the "
                "first-order half-life hides it", observed=round(p, 2), threshold=0.0)
    else:
        fitted = _fit_one_phase(t, y, k_lin)
        if fitted is None:
            return _unavailable(model, label, len(t), t_last, findings, plateau_q,
                                "the one-phase decay fit needs at least four observations at "
                                "three or more times and did not converge otherwise")
        (_y0, p, k_v), (_, ph, kh), r2 = fitted
        k_hat, k_ci = float(k_v), (float(k_v - kh), float(k_v + kh))
        plateau_q = Quantity.computed(
            float(p), "percent", method=m, software=_SOFTWARE, label=f"Plateau {label}",
            uncertainty=Uncertainty(kind="ci95", lower=float(p - ph), upper=float(p + ph),
                                    n=len(t)))
        if p - ph > 0:
            findings.append(QCFinding(
                f"{label}.incomplete_degradation", QCStatus.WARN,
                f"{label}: plateau {p:.1f}% (95% CI {p - ph:.1f} to {p + ph:.1f}) is above zero; "
                "the half-life describes only the degrading part", observed=round(float(p), 2),
                threshold=0.0))

    if r2 is not None and math.isfinite(r2) and r2 < min_r2:
        findings.append(QCFinding(f"{label}.poor_fit", QCStatus.WARN,
                                  f"{label}: R^2 {r2:.3f} below the stated {min_r2:g}",
                                  observed=round(r2, 4), threshold=min_r2))
    if k_hat is None or k_hat <= 0:
        return _unavailable(model, label, len(t), t_last, findings, plateau_q,
                            "the intact peptide did not decline over the incubation")
    t_half = math.log(2.0) / k_hat
    if t_half > t_last:
        return _unavailable(model, label, len(t), t_last, findings, plateau_q,
                            f"longer than the last sampling time ({t_last:g} min): an "
                            f"extrapolation; {last_mean:.1f}% remained at {t_last:g} min",
                            censored=True)
    if plateau_check is not None:
        findings.append(plateau_check)
    qc = QCVerdict.of(findings)
    assert k_ci is not None
    k_q = Quantity.computed(
        k_hat, "1/min", method=m, software=_SOFTWARE, label=f"k {label}", qc_flags=qc.flags,
        uncertainty=Uncertainty(kind="ci95", lower=k_ci[0], upper=k_ci[1], n=len(t)),
        notes=f"{len(t)} observations to {t_last:g} min" + (f", R^2={r2:.4f}" if r2 else ""))
    hi = math.log(2.0) / k_ci[0] if k_ci[0] > 0 else None
    t_q = Quantity.computed(
        t_half, "min", method=m, inputs=[k_q], software=_SOFTWARE, label=f"t1/2 {label}",
        qc_flags=qc.flags,
        uncertainty=Uncertainty(kind="ci95", lower=math.log(2.0) / k_ci[1], upper=hi,
                                n=len(t)),
        notes=None if hi is not None else "upper 95% limit unbounded: the rate's interval "
                                          "includes zero")
    return DecayFit(model, k_q, t_q, plateau_q, len(t), t_last, r2, False, qc)


def _unavailable(model: DecayModel, label: str, n: int, t_last: float,
                 findings: list[QCFinding], plateau: Quantity | None, reason: str,
                 censored: bool = False) -> DecayFit:
    qc = QCVerdict.of(findings)
    return DecayFit(model, Quantity.unavailable("1/min", reason=reason, label=f"k {label}"),
                    Quantity.unavailable("min", reason=reason, label=f"t1/2 {label}"),
                    plateau, n, t_last, None, censored, qc)
