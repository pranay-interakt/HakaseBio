"""Non-compartmental exposure analysis of a concentration-time profile.

Definitions (verified against the primary text, ``docs/research/drivers/in_vivo_pk.md``):

* **Cmax** is the maximum observed concentration, "obtained directly from the systemic drug
  concentration data without interpolation" (FDA, *Bioavailability Studies Submitted in NDAs
  or INDs*, April 2022, section III.A.9.a). **Tmax** is the time of that observation (CDISC
  TMAX, NCIt C70919).
* **AUC(0-t)** runs "from time zero to time t ... where t is the last time point with a
  measurable concentration" (FDA 2022, III.A.9.b; CDISC AUCLST, NCIt C85565).
* The non-compartmental method must be stated and reported (ICH M13A, 2024, 2.2.2.2), so the
  integration rule is an input, never a default:

  - linear trapezoid, segment area = (t2 - t1)(C1 + C2)/2;
  - linear-up/log-down, the linear trapezoid while concentrations rise or are equal and the
    logarithmic trapezoid, (t2 - t1)(C1 - C2)/ln(C1/C2), while they fall. The logarithmic
    segment is exact for mono-exponential decline and falls back to the linear one when either
    concentration is zero (Certara Phoenix 8.3 documentation, "Partial area calculation";
    Purves 1992 found log-trapezoid-based schemes performed well).

Below-the-LLOQ (BLQ) samples are handled by one declared rule, :data:`BLQ_RULE`: BLQ samples at
or before the first quantifiable concentration are set to zero (no measurable drug yet) and
every later BLQ sample is excluded, so that AUC(0-t) ends at the last measurable concentration
as defined above. A profile without a time-zero sample has no AUC(0-t): the definition starts
at time zero and nothing here extrapolates back.

Single-dose terminal-phase parameters (:func:`single_dose_nca`):

* **lambda_z** is the negative slope of the least-squares regression of ln C on t over the
  terminal points (FDA 2022 Appendix A section B: "three or more samples during the terminal
  log-linear phase ... from linear regression"; ICH M13A 2.1.8). Which points are terminal is
  a human selection, given as the terminal-phase start time; the candidate fits over the last
  3, 4, ... points after Tmax are listed to inform it, with the vendor "best fit" (largest
  adjusted R-squared, within 0.0001 preferring more points; Certara Phoenix) marked as a
  suggestion only. Adjusted R-squared = 1 - (1 - R^2)(n - 1)/(n - 2).
* **AUCinf** = AUC(0-t) + Clast/lambda_z (FDA 2022 III.A.9.b); **%AUC extrapolated** =
  100 (AUCinf - AUC(0-t))/AUCinf (EMA bioequivalence guideline, "residual area").
* **t1/2** = ln 2/lambda_z; **AUMC** by the same trapezoidal rule on C*t, linear
  dt(t1 C1 + t2 C2)/2 or logarithmic dt(t2 C2 - t1 C1)/ln(C2/C1) - dt^2 (C2 - C1)/ln(C2/C1)^2;
  **AUMCinf** = AUMC(0-t) + tlast Clast/lambda_z + Clast/lambda_z^2; **MRTinf** =
  AUMCinf/AUCinf, minus Tinf/2 for an infusion; **CL** = Dose/AUCinf (CL/F extravascular);
  **Vz** = Dose/(lambda_z AUCinf); **Vss** = CL x MRTinf for intravenous dosing only (Certara
  Phoenix 8.3 "NCA parameter formulas" and "Partial area calculation", a secondary source;
  the CL-Vss-MRT relation per Benet 2012). Each is exact for a mono-exponential profile.
* Concentration at dose time: zero for a single dose in drug-naive animals when declared so
  (Certara "NCA computation rules"), or a measured pre-dose sample. For an IV bolus, C0 is the
  observation at dose time or is back-extrapolated by log-linear regression through the first
  two quantifiable points (Certara "NCA computation rules"); where that regression does not
  decline, C0 is unavailable (the vendor's substitution of the first observation is not used).

Times are in hours and concentrations in one unit per profile; the caller attaches units.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import pairwise
from typing import Literal

__all__ = [
    "BLQ_RULE",
    "Administration",
    "AucMethod",
    "ExposureNCA",
    "LambdaZFit",
    "SingleDoseNCA",
    "apply_blq_rule",
    "auc",
    "auc_segment",
    "aumc",
    "aumc_segment",
    "back_extrapolate_c0",
    "bioavailability",
    "exposure_nca",
    "fit_lambda_z",
    "lambda_z_candidates",
    "single_dose_nca",
    "suggest_lambda_z",
]

Administration = Literal["extravascular", "iv_infusion", "iv_bolus"]
DoseTimeRule = Literal["zero_single_dose", "measured_predose"]

AucMethod = Literal["linear", "linear_up_log_down"]

#: The only BLQ handling this module implements; drivers record it in the protocol.
BLQ_RULE = ("BLQ at or before the first quantifiable concentration = 0; BLQ after the first "
            "quantifiable concentration excluded")


def auc_segment(t1: float, c1: float, t2: float, c2: float, method: AucMethod) -> float:
    """Area of one segment between consecutive samples."""
    dt = t2 - t1
    if dt <= 0:
        raise ValueError("sample times must be strictly increasing")
    if c1 < 0 or c2 < 0:
        raise ValueError("concentrations cannot be negative")
    if method == "linear_up_log_down" and c2 < c1 and c2 > 0:
        return dt * (c1 - c2) / math.log(c1 / c2)
    return dt * (c1 + c2) / 2.0


def auc(times: Sequence[float], concs: Sequence[float], method: AucMethod) -> float:
    """Area under the curve over the given samples (first to last time)."""
    if len(times) != len(concs):
        raise ValueError("times and concentrations differ in length")
    return sum(auc_segment(times[i], concs[i], times[i + 1], concs[i + 1], method)
               for i in range(len(times) - 1))


def apply_blq_rule(times: Sequence[float], concs: Sequence[float | None]
                   ) -> tuple[list[float], list[float]]:
    """Apply :data:`BLQ_RULE`. ``None`` marks a BLQ sample. Returns the samples kept."""
    first_q = next((i for i, c in enumerate(concs) if c is not None), None)
    t_out: list[float] = []
    c_out: list[float] = []
    for i, (t, c) in enumerate(zip(times, concs, strict=True)):
        if c is not None:
            t_out.append(float(t))
            c_out.append(float(c))
        elif first_q is None or i < first_q:
            t_out.append(float(t))
            c_out.append(0.0)
    return t_out, c_out


@dataclass(frozen=True, slots=True)
class ExposureNCA:
    """Exposure parameters of one profile. ``None`` means not estimable; see ``reasons``."""

    n_samples: int
    n_quantifiable: int
    cmax: float | None
    tmax: float | None
    clast: float | None
    tlast: float | None
    auc_last: float | None
    auc_tau: float | None
    reasons: dict[str, str]


def exposure_nca(times: Sequence[float], concs: Sequence[float | None], *, method: AucMethod,
                 tau_nominal_index: int | None = None, auc_estimable: bool = True
                 ) -> ExposureNCA:
    """Cmax, Tmax, Clast, Tlast, AUC(0-t) and, where the profile covers it, AUC(0-tau).

    ``times`` are actual sampling times (h) in increasing order; ``concs`` are concentrations
    with ``None`` for BLQ. ``tau_nominal_index`` is the index of the sample taken at the end of
    the dosing interval (nominal time = tau); AUC(0-tau) is reported only when that sample is
    quantifiable, in which case it equals AUC(0-t) to that sample's actual time. Otherwise
    reaching tau would need extrapolation, which is not performed.

    ``auc_estimable=False`` (a monitoring design, ICH S3A Note 1) reports concentrations only.
    """
    if any(b <= a for a, b in pairwise(times)):
        raise ValueError("sample times must be strictly increasing")
    if any(t < 0 for t in times):
        raise ValueError("sample times cannot be negative")
    reasons: dict[str, str] = {}
    quant = [(float(t), float(c)) for t, c in zip(times, concs, strict=True) if c is not None]
    if not quant:
        why = "no quantifiable concentration in the profile (all samples BLQ)"
        return ExposureNCA(len(times), 0, None, None, None, None, None, None,
                           {"cmax": why, "auc_last": why, "auc_tau": why})
    cmax = max(c for _, c in quant)
    tmax = next(t for t, c in quant if c == cmax)  # first occurrence when tied
    tlast, clast = quant[-1]
    auc_last: float | None = None
    auc_tau: float | None = None
    if not auc_estimable:
        reasons["auc_last"] = reasons["auc_tau"] = (
            "monitoring design: a small number of samples estimates C(time) or Cmax only; AUC "
            "needs a profile (ICH S3A Note 1)")
    elif times[0] != 0:
        reasons["auc_last"] = reasons["auc_tau"] = (
            "no time-zero (pre-dose) sample; AUC(0-t) starts at time zero and is not "
            "back-extrapolated")
    else:
        t_k, c_k = apply_blq_rule(times, concs)
        last = t_k.index(tlast)
        auc_last = auc(t_k[: last + 1], c_k[: last + 1], method)
        if tau_nominal_index is None:
            reasons["auc_tau"] = "no sample at the end of the dosing interval"
        elif concs[tau_nominal_index] is None:
            reasons["auc_tau"] = ("the end-of-interval sample is BLQ; AUC(0-tau) would need "
                                  "extrapolation, which is not performed")
        else:
            idx = t_k.index(float(times[tau_nominal_index]))
            auc_tau = auc(t_k[: idx + 1], c_k[: idx + 1], method)
    return ExposureNCA(len(times), len(quant), cmax, tmax, clast, tlast, auc_last, auc_tau,
                       reasons)


# ---------------------------------------------------------------------------------------------
# Single-dose terminal phase
# ---------------------------------------------------------------------------------------------


def aumc_segment(t1: float, c1: float, t2: float, c2: float, method: AucMethod) -> float:
    """Area under the first-moment curve (C*t) of one segment."""
    dt = t2 - t1
    if dt <= 0:
        raise ValueError("sample times must be strictly increasing")
    if c1 < 0 or c2 < 0:
        raise ValueError("concentrations cannot be negative")
    if method == "linear_up_log_down" and c2 < c1 and c2 > 0:
        lr = math.log(c2 / c1)
        return dt * (t2 * c2 - t1 * c1) / lr - dt * dt * (c2 - c1) / (lr * lr)
    return dt * (t1 * c1 + t2 * c2) / 2.0


def aumc(times: Sequence[float], concs: Sequence[float], method: AucMethod) -> float:
    return sum(aumc_segment(times[i], concs[i], times[i + 1], concs[i + 1], method)
               for i in range(len(times) - 1))


@dataclass(frozen=True, slots=True)
class LambdaZFit:
    start_time: float
    end_time: float
    n_points: int
    lambda_z: float
    ln_intercept: float
    r_squared: float
    adj_r_squared: float


def fit_lambda_z(times: Sequence[float], concs: Sequence[float]) -> LambdaZFit | None:
    """Least-squares fit of ln C on t. None when fewer than 3 points, a non-positive
    concentration, or no decline (slope >= 0)."""
    n = len(times)
    if n < 3 or any(c <= 0 for c in concs):
        return None
    y = [math.log(c) for c in concs]
    tbar, ybar = sum(times) / n, sum(y) / n
    sxx = sum((t - tbar) ** 2 for t in times)
    sxy = sum((t - tbar) * (v - ybar) for t, v in zip(times, y, strict=True))
    slope = sxy / sxx
    if slope >= 0:
        return None
    a = ybar - slope * tbar
    ss_res = sum((v - (a + slope * t)) ** 2 for t, v in zip(times, y, strict=True))
    ss_tot = sum((v - ybar) ** 2 for v in y)
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 1.0
    adj = 1.0 - (1.0 - r2) * (n - 1) / (n - 2)
    return LambdaZFit(float(times[0]), float(times[-1]), n, -slope, a, r2, adj)


def lambda_z_candidates(times: Sequence[float], concs: Sequence[float | None],
                        tmax: float) -> list[LambdaZFit]:
    """Fits over the last 3, 4, ... quantifiable points after Tmax."""
    pts = [(float(t), float(c)) for t, c in zip(times, concs, strict=True)
           if c is not None and t > tmax]
    out = []
    for k in range(3, len(pts) + 1):
        fit = fit_lambda_z([t for t, _ in pts[-k:]], [c for _, c in pts[-k:]])
        if fit is not None:
            out.append(fit)
    return out


def suggest_lambda_z(candidates: Sequence[LambdaZFit]) -> LambdaZFit | None:
    """Vendor convention (Certara Phoenix "best fit"): the largest adjusted R-squared; among
    fits within 0.0001 of it, the one with the most points. A suggestion, not a decision."""
    if not candidates:
        return None
    best = max(c.adj_r_squared for c in candidates)
    return max((c for c in candidates if c.adj_r_squared >= best - 1e-4),
               key=lambda c: c.n_points)


def back_extrapolate_c0(times: Sequence[float], concs: Sequence[float | None]) -> float | None:
    """IV bolus C0 by log-linear regression through the first two quantifiable points; None
    when they do not decline."""
    pts = [(float(t), float(c)) for t, c in zip(times, concs, strict=True)
           if c is not None and c > 0][:2]
    if len(pts) < 2 or pts[1][1] >= pts[0][1]:
        return None
    (t1, c1), (t2, c2) = pts
    k = math.log(c1 / c2) / (t2 - t1)
    return c1 * math.exp(k * t1)


def bioavailability(auc_ev: float, dose_ev: float, auc_iv: float, dose_iv: float) -> float:
    """F = (AUC_ev x Dose_iv)/(AUC_iv x Dose_ev), dose-normalised (assumes linear PK between
    the two doses)."""
    return (auc_ev * dose_iv) / (auc_iv * dose_ev)


@dataclass(frozen=True, slots=True)
class SingleDoseNCA:
    n_samples: int
    n_quantifiable: int
    cmax: float | None
    tmax: float | None
    clast: float | None
    tlast: float | None
    c0: float | None
    auc_last: float | None
    aumc_last: float | None
    candidates: tuple[LambdaZFit, ...]
    suggestion: LambdaZFit | None
    terminal: LambdaZFit | None
    lambda_z: float | None
    half_life: float | None
    auc_inf: float | None
    auc_pct_extrap: float | None
    aumc_inf: float | None
    mrt_inf: float | None
    reasons: dict[str, str]


def single_dose_nca(times: Sequence[float], concs: Sequence[float | None], *,
                    administration: Administration, method: AucMethod,
                    dose_time_rule: DoseTimeRule, terminal_start: float | None,
                    infusion_duration: float | None = None) -> SingleDoseNCA:
    """Non-compartmental analysis of one single-dose profile (see the module docstring).

    ``terminal_start`` is the human-selected first time of the terminal phase; without it the
    lambda_z-dependent parameters are unavailable."""
    if any(b <= a for a, b in pairwise(times)) or any(t < 0 for t in times):
        raise ValueError("sample times must be non-negative and strictly increasing")
    reasons: dict[str, str] = {}
    quant = [(float(t), float(c)) for t, c in zip(times, concs, strict=True) if c is not None]
    if not quant:
        why = "no quantifiable concentration in the profile (all samples BLQ)"
        return SingleDoseNCA(len(times), 0, None, None, None, None, None, None, None, (), None,
                             None, None, None, None, None, None, None,
                             {k: why for k in ("cmax", "auc_last", "lambda_z")})
    cmax = max(c for _, c in quant)
    tmax = next(t for t, c in quant if c == cmax)
    tlast, clast = quant[-1]
    t_k, c_k = apply_blq_rule(times, concs)
    c0: float | None = None
    if administration == "iv_bolus":
        if t_k and t_k[0] == 0 and c_k[0] > 0:
            c0 = c_k[0]
        else:
            c0 = back_extrapolate_c0(times, concs)
            if c0 is None:
                reasons["auc_last"] = ("IV bolus C0 cannot be back-extrapolated: the first two "
                                       "quantifiable concentrations do not decline")
            else:
                t_k, c_k = [0.0, *[t for t in t_k if t > 0]], [c0, *[c for t, c in
                                                                      zip(t_k, c_k, strict=True)
                                                                      if t > 0]]
    elif not t_k or t_k[0] != 0:
        if dose_time_rule == "zero_single_dose":
            t_k, c_k = [0.0, *t_k], [0.0, *c_k]
        else:
            reasons["auc_last"] = ("no pre-dose (time 0) sample; the protocol requires a "
                                   "measured concentration at dose time")
    auc_last = aumc_last = None
    if "auc_last" not in reasons:
        last = t_k.index(tlast)
        auc_last = auc(t_k[: last + 1], c_k[: last + 1], method)
        aumc_last = aumc(t_k[: last + 1], c_k[: last + 1], method)
    cands = tuple(lambda_z_candidates(times, concs, tmax))
    suggestion = suggest_lambda_z(cands)
    terminal = None
    if terminal_start is None:
        reasons["lambda_z"] = "terminal phase not selected by the scientist"
    else:
        pts = [(t, c) for t, c in quant if t >= terminal_start - 1e-9]
        terminal = fit_lambda_z([t for t, _ in pts], [c for _, c in pts])
        if terminal is None:
            reasons["lambda_z"] = (f"the selected terminal phase (from {terminal_start:g} h) has "
                                   f"{len(pts)} quantifiable points or does not decline; at "
                                   "least 3 declining points are needed (FDA 2022 Appendix A)")
    lz = terminal.lambda_z if terminal else None
    half = math.log(2) / lz if lz else None
    auc_inf = pct = aumc_inf = mrt = None
    if lz and auc_last is not None and aumc_last is not None:
        auc_inf = auc_last + clast / lz
        pct = 100.0 * (auc_inf - auc_last) / auc_inf
        aumc_inf = aumc_last + tlast * clast / lz + clast / (lz * lz)
        mrt = aumc_inf / auc_inf
        if administration == "iv_infusion":
            if infusion_duration is None:
                raise ValueError("an infusion needs its duration")
            mrt -= infusion_duration / 2.0
    elif lz:
        reasons["auc_inf"] = reasons.get("auc_last", "AUC(0-t) not available")
    else:
        reasons["auc_inf"] = reasons["lambda_z"]
    return SingleDoseNCA(len(times), len(quant), cmax, tmax, clast, tlast, c0, auc_last,
                         aumc_last, cands, suggestion, terminal, lz, half, auc_inf, pct,
                         aumc_inf, mrt, reasons)
