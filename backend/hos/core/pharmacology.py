"""Concentration-response analysis and derived safety margins.

The four-parameter logistic (Hill) model is the standard description of a
sigmoidal concentration-response relationship (DeLean, Munson & Rodbard 1978):

``y = bottom + (top - bottom) / (1 + (C / IC50) ** hill)``

At ``C << IC50`` the response approaches ``top``; at ``C >> IC50`` it approaches
``bottom``; at ``C = IC50`` it is exactly midway. The fit is by non-linear least
squares, and the potency is reported with a confidence interval derived from the
parameter covariance. A potency that falls outside the tested concentration range
is an extrapolation and is flagged as such rather than reported as if measured.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np
import scipy
from scipy.optimize import curve_fit

from hos.core.methods import method
from hos.core.provenance import Uncertainty
from hos.core.qc import QCFinding, QCStatus, QCVerdict
from hos.core.quantity import MeasurementSeries, Quantity, QuantityError

__all__ = ["HillFit", "fit_hill", "four_parameter_logistic", "herg_safety_margin"]

_SOFTWARE = {"numpy": np.__version__, "scipy": scipy.__version__}


def four_parameter_logistic(
    concentration: np.ndarray, bottom: float, top: float, ic50: float, hill: float
) -> np.ndarray:
    """The 4PL model function. ``ic50`` must be positive."""
    with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
        return bottom + (top - bottom) / (1.0 + (concentration / ic50) ** hill)


@dataclass(frozen=True, slots=True)
class HillFit:
    """Fitted concentration-response curve."""

    ic50: Quantity
    hill_slope: Quantity
    top: Quantity
    bottom: Quantity
    r_squared: float
    n_points: int
    concentration_range: tuple[float, float]
    concentration_unit: str
    extrapolated: bool
    qc: QCVerdict

    def predict(self, concentration: float) -> float:
        return float(
            four_parameter_logistic(
                np.asarray([concentration], dtype=float),
                self.bottom.require(),
                self.top.require(),
                self.ic50.require(),
                self.hill_slope.require(),
            )[0]
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "ic50": self.ic50.to_dict(),
            "hill_slope": self.hill_slope.to_dict(),
            "top": self.top.to_dict(),
            "bottom": self.bottom.to_dict(),
            "r_squared": self.r_squared,
            "n_points": self.n_points,
            "concentration_range": list(self.concentration_range),
            "concentration_unit": self.concentration_unit,
            "extrapolated": self.extrapolated,
            "qc": self.qc.to_dict(),
        }


def fit_hill(
    series: MeasurementSeries,
    *,
    min_r2: float,
    potency_label: str = "IC50",
    fix_bottom: float | None = None,
    fix_top: float | None = None,
    hill_slope_warn_range: tuple[float, float] | None = None,
) -> HillFit:
    """Fit a 4PL curve to concentration-response data.

    ``series.x`` is concentration (must be strictly positive), ``series.y`` the
    response. ``fix_top``/``fix_bottom`` pin the asymptotes when the assay defines
    them (for example 0 and 100 percent inhibition). ``min_r2`` is a run-acceptance
    criterion stated by the caller. ``hill_slope_warn_range``, if given, flags slopes
    outside a range the caller states (with its own basis); none is applied by default.
    """
    x = np.asarray(series.x, dtype=float)
    y = np.asarray(series.y, dtype=float)
    if np.any(x <= 0):
        raise QuantityError("concentrations must be strictly positive for a log-scale fit")
    order = np.argsort(x)
    x, y = x[order], y[order]

    if series.n < 4:
        raise QuantityError(
            f"a four-parameter fit needs at least 4 points, got {series.n}; "
            "reduce the model or collect more concentrations"
        )

    y_lo, y_hi = float(np.min(y)), float(np.max(y))
    descending = float(y[0]) >= float(y[-1])
    p_top = fix_top if fix_top is not None else (y_hi if descending else y_lo)
    p_bottom = fix_bottom if fix_bottom is not None else (y_lo if descending else y_hi)
    midpoint = (p_top + p_bottom) / 2.0
    idx = int(np.argmin(np.abs(y - midpoint)))
    p_ic50 = float(x[idx]) if x[idx] > 0 else float(np.median(x))
    p_hill = 1.0

    lo_c, hi_c = float(x[0]), float(x[-1])
    span = hi_c / lo_c

    def model(c: np.ndarray, bottom: float, top: float, ic50: float, hill: float) -> np.ndarray:
        b = fix_bottom if fix_bottom is not None else bottom
        t = fix_top if fix_top is not None else top
        return four_parameter_logistic(c, b, t, ic50, hill)

    y_range = max(abs(y_hi - y_lo), 1e-12)
    bounds = (
        [y_lo - 5 * y_range, y_lo - 5 * y_range, lo_c / (span * 100.0), 0.1],
        [y_hi + 5 * y_range, y_hi + 5 * y_range, hi_c * span * 100.0, 10.0],
    )
    p0 = [p_bottom, p_top, p_ic50, p_hill]
    p0 = [min(max(v, lo), hi) for v, lo, hi in zip(p0, bounds[0], bounds[1], strict=True)]

    findings: list[QCFinding] = []
    try:
        popt, pcov = curve_fit(model, x, y, p0=p0, bounds=bounds, maxfev=40000)
    except Exception as exc:
        raise QuantityError(f"concentration-response fit did not converge: {exc}") from exc

    bottom_v, top_v, ic50_v, hill_v = (float(v) for v in popt)
    if fix_bottom is not None:
        bottom_v = fix_bottom
    if fix_top is not None:
        top_v = fix_top

    resid = y - model(x, *popt)
    ss_res = float(np.sum(resid**2))
    ss_tot = float(np.sum((y - np.mean(y)) ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else float("nan")

    perr = np.sqrt(np.diag(pcov)) if pcov is not None and np.all(np.isfinite(pcov)) else None
    ic50_se = float(perr[2]) if perr is not None and np.isfinite(perr[2]) else None
    hill_se = float(perr[3]) if perr is not None and np.isfinite(perr[3]) else None

    # A parameter that has come to rest on a fitting bound is not a fitted value: the data
    # wanted to go further. Reporting it unmarked would present the bound as the answer.
    for name, value, lo, hi in (
        ("hill_slope", hill_v, bounds[0][3], bounds[1][3]),
        ("ic50", ic50_v, bounds[0][2], bounds[1][2]),
    ):
        if math.isclose(value, lo, rel_tol=1e-6) or math.isclose(value, hi, rel_tol=1e-6):
            findings.append(
                QCFinding(
                    code=f"{name}_at_fit_bound",
                    status=QCStatus.WARN,
                    message=f"the fitted {name.replace('_', ' ')} reached the bound the fit "
                    "is constrained to, so it is a limit of the fit rather than a value the "
                    "data determined",
                    observed=value,
                )
            )

    extrapolated = not (lo_c <= ic50_v <= hi_c)
    if extrapolated:
        findings.append(
            QCFinding(
                code="potency_extrapolated",
                status=QCStatus.WARN,
                message=f"fitted {potency_label} lies outside the tested concentration range "
                f"[{lo_c:g}, {hi_c:g}]; it is an extrapolation, not a measurement",
                observed=ic50_v,
                threshold=[lo_c, hi_c],
            )
        )
    if math.isfinite(r2) and r2 < min_r2:
        findings.append(
            QCFinding(
                code="poor_curve_fit",
                status=QCStatus.WARN,
                message="curve fit quality below threshold",
                observed=round(r2, 4),
                threshold=min_r2,
            )
        )
    if hill_slope_warn_range is not None and not (
        hill_slope_warn_range[0] <= abs(hill_v) <= hill_slope_warn_range[1]
    ):
        findings.append(
            QCFinding(
                code="hill_slope_outside_stated_range",
                status=QCStatus.WARN,
                message="Hill slope outside the range stated for this assay; this can indicate "
                "a non-specific effect, solubility limitation or multi-site interaction",
                observed=round(hill_v, 3),
                threshold=list(hill_slope_warn_range),
            )
        )
    qc = QCVerdict.of(findings)
    m = method("pharm.hill_4pl")
    unit = series.x_unit

    ci = None
    if ic50_se is not None:
        ci = Uncertainty(
            kind="ci95",
            lower=max(ic50_v - 1.96 * ic50_se, 0.0),
            upper=ic50_v + 1.96 * ic50_se,
            sd=ic50_se,
            n=series.n,
        )

    return HillFit(
        ic50=Quantity.computed(
            ic50_v,
            unit,
            method=m,
            software=_SOFTWARE,
            uncertainty=ci,
            label=potency_label,
            qc_flags=qc.flags,
            notes=f"4PL fit over {series.n} concentrations, R^2={r2:.4f}",
        ),
        hill_slope=Quantity.computed(
            hill_v,
            "dimensionless",
            method=m,
            software=_SOFTWARE,
            uncertainty=Uncertainty(kind="sd", sd=hill_se, n=series.n) if hill_se else None,
            label="Hill slope",
            qc_flags=qc.flags,
        ),
        top=Quantity.computed(
            top_v, series.y_unit, method=m, software=_SOFTWARE, label="Upper asymptote"
        ),
        bottom=Quantity.computed(
            bottom_v, series.y_unit, method=m, software=_SOFTWARE, label="Lower asymptote"
        ),
        r_squared=r2,
        n_points=series.n,
        concentration_range=(lo_c, hi_c),
        concentration_unit=unit,
        extrapolated=extrapolated,
        qc=qc,
    )


def herg_safety_margin(ic50: Quantity, free_cmax: Quantity) -> Quantity:
    """Margin between the hERG IC50 and the free therapeutic plasma concentration.

    ``margin = IC50(free) / Cmax(free)``

    Redfern et al. (2003) observed that drugs withdrawn for torsades de pointes
    clustered at margins below roughly 30-fold, and that value is widely used as a
    screening reference point. It is a *reference point*, not a regulatory limit:
    the margin is reported with its inputs and the user draws the conclusion.
    ICH S7B and the ICH E14/S7B Q&A govern the formal assessment.
    """
    if not ic50.is_available or not free_cmax.is_available:
        missing = ic50 if not ic50.is_available else free_cmax
        return Quantity.unavailable(
            "dimensionless",
            reason=f"cannot compute hERG margin: {missing.provenance.reason}",
            label="hERG safety margin",
        )
    cmax = free_cmax.magnitude_in(ic50.unit)
    if cmax <= 0:
        raise QuantityError("free Cmax must be positive")
    margin = ic50.require() / cmax
    flags = list(ic50.qc_flags)
    if margin < 30.0:
        flags.append("herg_margin_below_30x_reference")
    return Quantity.computed(
        margin,
        "dimensionless",
        method=method("safety.herg_margin"),
        inputs=[ic50, free_cmax],
        software=_SOFTWARE,
        label="hERG safety margin (IC50 / free Cmax)",
        qc_flags=dict.fromkeys(flags),
        notes="Redfern 2003 reports clustering of torsadogenic drugs below ~30x; "
        "this is a screening reference point, not a pass/fail criterion",
    )
