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
    "AucMethod",
    "ExposureNCA",
    "apply_blq_rule",
    "auc",
    "auc_segment",
    "exposure_nca",
]

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
