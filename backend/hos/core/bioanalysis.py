"""Bioanalytical method validation and study-sample analysis (chromatographic methods).

Implements the computations of ICH M10 (Step 4, 24 May 2022) section 3 and section 5:

* calibration: a simple regression model of response on nominal concentration, with the
  model and weighting fixed by the laboratory's written procedure (M10 3.2.4: "The
  regression model, weighting scheme and transformation should be determined during the
  method validation"); back-calculated concentrations and their accuracy;
* accuracy (mean back-calculated / nominal, %) and precision (%CV) of QCs within and
  between runs (M10 3.2.5.2: between-run values "calculated by combining the data from all
  runs");
* interference relative to the LLOQ analyte and IS responses (selectivity 3.2.1,
  specificity 3.2.2, carry-over 3.2.6);
* incurred-sample reanalysis percent difference (M10 section 5).

The acceptance criteria are M10's own numbers, held in :data:`M10_CHROMATOGRAPHIC` with the
section that states each; nothing here is a laboratory default.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np

__all__ = [
    "M10_CHROMATOGRAPHIC",
    "M10_LIGAND_BINDING_ISR",
    "CalibrationFit",
    "accuracy_percent",
    "bias_percent",
    "cv_percent",
    "fit_calibration",
    "isr_percent_difference",
    "isr_required_count",
]

Model = Literal["linear", "quadratic"]
Weighting = Literal["none", "1/x", "1/x^2"]


@dataclass(frozen=True, slots=True)
class M10Criterion:
    key: str
    value: float
    unit: str
    section: str
    statement: str


#: Acceptance criteria for chromatographic methods, transcribed from ICH M10 (verified
#: against the official PDF, database.ich.org M10_Guideline_Step4_2022_0524.pdf).
M10_CHROMATOGRAPHIC: dict[str, M10Criterion] = {c.key: c for c in (
    M10Criterion("cal_min_levels", 6, "levels", "3.2.4",
                 "at least 6 concentration levels of calibration standards, including the LLOQ "
                 "and the ULOQ"),
    M10Criterion("cal_accuracy", 15, "percent", "3.2.4",
                 "back-calculated concentrations within ±15% of nominal (±20% at the LLOQ)"),
    M10Criterion("cal_accuracy_lloq", 20, "percent", "3.2.4", "±20% at the LLOQ"),
    M10Criterion("cal_fraction_passing", 75, "percent", "3.2.4",
                 "at least 75% of the calibration standards with a minimum of 6 calibration "
                 "standard levels should meet the above criteria"),
    M10Criterion("qc_accuracy", 15, "percent", "3.2.5.2",
                 "accuracy within ±15% of nominal, except at the LLOQ (±20%)"),
    M10Criterion("qc_accuracy_lloq", 20, "percent", "3.2.5.2", "±20% at the LLOQ"),
    M10Criterion("qc_cv", 15, "percent", "3.2.5.2",
                 "precision (%CV) not exceeding 15%, except at the LLOQ (20%)"),
    M10Criterion("qc_cv_lloq", 20, "percent", "3.2.5.2", "%CV not exceeding 20% at the LLOQ"),
    M10Criterion("ap_min_runs", 3, "runs", "3.2.5.2",
                 "each QC level in at least 3 analytical runs over at least two days"),
    M10Criterion("ap_min_replicates", 5, "replicates", "3.2.5.2",
                 "at least 5 replicates at each QC concentration level in each analytical run"),
    M10Criterion("interference_analyte", 20, "percent", "3.2.1",
                 "not more than 20% of the analyte response at the LLOQ"),
    M10Criterion("interference_is", 5, "percent", "3.2.1",
                 "not more than 5% of the IS response in the LLOQ sample"),
    M10Criterion("selectivity_min_sources", 6, "sources", "3.2.1",
                 "blank samples from at least 6 individual sources/lots"),
    M10Criterion("matrix_min_sources", 6, "sources", "3.2.3",
                 "low and high QCs, each prepared using matrix from at least 6 different "
                 "sources/lots"),
    M10Criterion("matrix_min_replicates", 3, "replicates", "3.2.3",
                 "at least 3 replicates of low and high QCs"),
    M10Criterion("matrix_accuracy", 15, "percent", "3.2.3",
                 "for each matrix source/lot accuracy within ±15% of nominal"),
    M10Criterion("matrix_cv", 15, "percent", "3.2.3", "precision (%CV) not greater than 15%"),
    M10Criterion("carryover_analyte", 20, "percent", "3.2.6",
                 "carry-over not greater than 20% of the analyte response at the LLOQ"),
    M10Criterion("carryover_is", 5, "percent", "3.2.6", "and 5% of the response for the IS"),
    M10Criterion("dilution_min_replicates", 5, "replicates", "3.2.7",
                 "at least 5 replicates per dilution factor"),
    M10Criterion("dilution_accuracy", 15, "percent", "3.2.7",
                 "mean accuracy of the dilution QCs within ±15% of nominal"),
    M10Criterion("dilution_cv", 15, "percent", "3.2.7", "precision (%CV) not exceeding 15%"),
    M10Criterion("stability_min_aliquots", 3, "aliquots", "3.2.8",
                 "the bulk sample divided into a minimum of 3 aliquots"),
    M10Criterion("stability_accuracy", 15, "percent", "3.2.8",
                 "mean concentration at each QC level within ±15% of nominal"),
    M10Criterion("freeze_thaw_min_cycles", 3, "cycles", "3.2.8",
                 "a minimum of three cycles should be conducted"),
    M10Criterion("isr_limit", 20, "percent", "5",
                 "for chromatographic methods, the percent difference should be within ±20% "
                 "for at least 2/3 of the repeats"),
    M10Criterion("isr_fraction", 2 / 3, "dimensionless", "5", "at least 2/3 of the repeats"),
)}

#: ISR limit for ligand binding assays (M10 section 5: "For LBAs, the percent difference
#: should be within ±30% for at least 2/3 of the repeats").
M10_LIGAND_BINDING_ISR = M10Criterion(
    "isr_limit", 30, "percent", "5",
    "for LBAs, the percent difference should be within ±30% for at least 2/3 of the repeats")


@dataclass(frozen=True, slots=True)
class CalibrationFit:
    model: Model
    weighting: Weighting
    coefficients: tuple[float, ...]  # (intercept, slope) or (intercept, slope, quadratic)
    n_points: int
    r_squared: float

    def predict(self, conc: float) -> float:
        c = self.coefficients
        return c[0] + c[1] * conc + (c[2] * conc * conc if len(c) == 3 else 0.0)

    def back_calculate(self, response: float) -> float | None:
        """Concentration giving ``response``; None if the curve cannot be inverted there."""
        c = self.coefficients
        if len(c) == 2:
            return None if c[1] == 0 else (response - c[0]) / c[1]
        a, b, k = c[2], c[1], c[0] - response
        if a == 0:
            return None if b == 0 else -k / b
        disc = b * b - 4 * a * k
        if disc < 0:
            return None
        roots = [(-b + s * math.sqrt(disc)) / (2 * a) for s in (1.0, -1.0)]
        pos = [r for r in roots if r >= 0]
        return min(pos) if pos else None

    def to_dict(self) -> dict[str, Any]:
        return {"model": self.model, "weighting": self.weighting,
                "coefficients": list(self.coefficients), "n_points": self.n_points,
                "r_squared": self.r_squared}


def _weights(x: np.ndarray, weighting: Weighting) -> np.ndarray:
    if weighting == "none":
        return np.ones_like(x)
    if np.any(x <= 0):
        raise ValueError("concentration-based weighting needs positive nominal concentrations")
    return 1.0 / x if weighting == "1/x" else 1.0 / (x * x)


def fit_calibration(nominal: Sequence[float], response: Sequence[float], *, model: Model,
                    weighting: Weighting) -> CalibrationFit:
    """Weighted least-squares fit of response on nominal concentration.

    Minimises sum(w_i * (y_i - f(x_i))^2) with w_i = 1, 1/x_i or 1/x_i^2 as stated by the
    laboratory's procedure (M10 3.2.4)."""
    x = np.asarray(nominal, dtype=float)
    y = np.asarray(response, dtype=float)
    deg = 1 if model == "linear" else 2
    if len(x) < deg + 2:
        raise ValueError(f"a {model} calibration needs at least {deg + 2} points")
    w = _weights(x, weighting)
    design = np.vander(x, deg + 1, increasing=True)
    sw = np.sqrt(w)
    coef, *_ = np.linalg.lstsq(design * sw[:, None], y * sw, rcond=None)
    fitted = design @ coef
    ybar = float(np.sum(w * y) / np.sum(w))
    ss_res = float(np.sum(w * (y - fitted) ** 2))
    ss_tot = float(np.sum(w * (y - ybar) ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else float("nan")
    return CalibrationFit(model=model, weighting=weighting,
                          coefficients=tuple(float(c) for c in coef), n_points=len(x),
                          r_squared=r2)


def accuracy_percent(measured: float, nominal: float) -> float:
    """Measured as a percentage of nominal (M10 glossary: accuracy as % of nominal)."""
    return 100.0 * measured / nominal


def bias_percent(measured: float, nominal: float) -> float:
    return 100.0 * (measured - nominal) / nominal


def cv_percent(values: Sequence[float]) -> float | None:
    """Coefficient of variation (sample SD / mean, %). None with fewer than two values."""
    v = np.asarray(values, dtype=float)
    if len(v) < 2 or float(np.mean(v)) == 0:
        return None
    return float(100.0 * np.std(v, ddof=1) / np.mean(v))


def isr_percent_difference(initial: float, repeat: float) -> float:
    """M10 section 5: % difference = (repeat - initial) / mean(repeat, initial) x 100."""
    mean = (initial + repeat) / 2.0
    if mean == 0:
        raise ValueError("ISR percent difference is undefined when both values are zero")
    return 100.0 * (repeat - initial) / mean


def isr_required_count(total_samples: int) -> int:
    """M10 section 5 minimum ISR sample count: 10% of the first 1000 samples plus 5% of the
    number exceeding 1000 (rounded up)."""
    if total_samples <= 0:
        return 0
    first = min(total_samples, 1000)
    rest = max(total_samples - 1000, 0)
    return math.ceil(0.10 * first) + math.ceil(0.05 * rest)
