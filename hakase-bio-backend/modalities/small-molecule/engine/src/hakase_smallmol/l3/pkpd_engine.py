"""PK metrics, dose–exposure relationships, and mechanistic target coverage.

All quantities are derived from the cohort simulation and the L1/L2 potency — no
independent modelling of effect is invented. "Target coverage" is mass-action
receptor occupancy from the free-drug concentration and the measured/predicted
binding affinity (Kd), which is a mechanistic PD surrogate, not an efficacy
claim. When potency is absent the coverage/PK-PD blocks return ``not_predicted``.
"""

from __future__ import annotations

import math
from typing import Any

# Tissues surfaced in the PK-metric table (plasma + the modelled organs).
_METRIC_TISSUES = ("plasma", "liver", "kidney", "heart", "brain", "muscle", "adipose")


def pk_metrics_for_arm(arm_result: dict[str, Any]) -> dict[str, Any]:
    """Extract the toxicokinetic metric table (Cmax/Tmax/AUC/CL/Vss/t½) with the
    cohort's 90% intervals, per tissue — copied verbatim from the simulation."""
    endpoints = (arm_result.get("cohort") or {}).get("endpoints") or {}
    tissues: dict[str, Any] = {}
    for tissue in _METRIC_TISSUES:
        ep = endpoints.get(tissue)
        if not ep:
            continue
        tissues[tissue] = {
            "c_max": ep.get("c_max"),
            "t_max": ep.get("t_max"),
            "auc": ep.get("auc"),
            "cl": ep.get("cl"),
            "vss": ep.get("vss"),
            "t_half": ep.get("t_half"),
        }
    return {
        "available": bool(tissues),
        "units": {
            "c_max": "mg/L",
            "t_max": "h",
            "auc": "mg·h/L",
            "cl": "L/h",
            "vss": "L/kg",
            "t_half": "h",
        },
        "tissues": tissues,
        "model": "Hakase kernel PBPK virtual cohort",
        "provenance": "derived",
        "limitations": (
            "Metrics are cohort medians with 5th–95th percentile intervals reflecting "
            "inter-animal physiological and disposition-parameter variability."
        ),
    }


def _median_auc(arm_result: dict[str, Any], tissue: str = "plasma") -> float | None:
    ep = ((arm_result.get("cohort") or {}).get("endpoints") or {}).get(tissue) or {}
    auc = ep.get("auc") or {}
    v = auc.get("median")
    return float(v) if isinstance(v, (int, float)) and v > 0 else None


def dose_proportionality(arm_results: list[dict[str, Any]]) -> dict[str, Any]:
    """Assess dose-proportionality via the power model AUC = a·Dose^β.

    β (the slope of log AUC vs log dose) ≈ 1 → dose-proportional (linear PK);
    β < 1 → less-than-proportional (e.g. saturable absorption); β > 1 →
    more-than-proportional (e.g. saturable clearance). Requires ≥2 active arms.
    """
    points = []
    for arm in arm_results:
        if not arm.get("available"):
            continue
        dose = (arm.get("arm") or {}).get("dose_mg_per_kg")
        auc = _median_auc(arm)
        if dose and dose > 0 and auc:
            points.append((float(dose), float(auc)))
    if len(points) < 2:
        return {
            "available": False,
            "reason": "Dose-proportionality needs at least two active dose groups with exposure.",
        }
    xs = [math.log(d) for d, _ in points]
    ys = [math.log(a) for _, a in points]
    n = len(points)
    mx = sum(xs) / n
    my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True))
    if sxx <= 0:
        return {"available": False, "reason": "Dose groups are not distinct enough to fit a slope."}
    beta = sxy / sxx
    if 0.9 <= beta <= 1.1:
        classification = "dose-proportional (linear)"
    elif beta < 0.9:
        classification = "less-than-proportional (possible saturable absorption / solubility limit)"
    else:
        classification = "more-than-proportional (possible saturable clearance)"
    return {
        "available": True,
        "beta_slope": round(beta, 3),
        "classification": classification,
        "n_dose_groups": n,
        "points": [{"dose_mg_per_kg": d, "auc_median": a} for d, a in points],
        "model": "Power model AUC = a·Dose^β (log-log regression on cohort median AUC)",
        "provenance": "derived",
        "limitations": "Estimated from median AUC only; a full analysis would use individual-animal AUCs.",
    }


def _conc_series_nM(
    arm_result: dict[str, Any], tissue: str, mw: float
) -> tuple[list[float], list[float]] | None:
    """Return (time_h, C_nM) for the cohort mean curve of a tissue.

    Converts mg/L → nM using molecular weight: C[nM] = C[mg/L] / MW[g/mol] · 1e6.
    """
    cohort = arm_result.get("cohort") or {}
    times = cohort.get("time")
    curve = (cohort.get("curves") or {}).get(tissue) or {}
    mean = curve.get("mean")
    if not times or not mean or not (mw and mw > 0):
        return None
    factor = 1.0e6 / mw
    return list(times), [float(c) * factor for c in mean]


def target_coverage(
    arm_result: dict[str, Any],
    potency: dict[str, Any] | None,
    *,
    tissue: str = "plasma",
    occupancy_threshold: float = 0.5,
) -> dict[str, Any]:
    """Mechanistic target coverage: receptor occupancy from free drug + Kd.

    Occupancy(t) = C_free(t) / (C_free(t) + Kd)   (1:1 mass-action, Hill n=1).
    C_free = C_total · fu_plasma. Reports the peak occupancy, the average
    occupancy, and the fraction of the dosing window with occupancy above the
    threshold. Absent potency → ``not_predicted`` (never a fabricated coverage).
    """
    if not potency or not (potency.get("value_nM") and potency["value_nM"] > 0):
        return {
            "available": False,
            "reason": "No target potency (Ki/IC50/Kd) available; target coverage not predicted.",
        }
    mw = (arm_result.get("ivive") or {}).get("mw_g_per_mol")
    fu = (((arm_result.get("ivive") or {}).get("inputs") or {}).get("fu_plasma") or {}).get("value")
    series = _conc_series_nM(arm_result, tissue, mw) if mw else None
    if series is None or fu is None:
        return {
            "available": False,
            "reason": "Missing molecular weight, unbound fraction, or tissue curve for coverage.",
            "missing": [k for k, v in (("mw", mw), ("fu_plasma", fu), ("curve", series)) if not v],
        }
    kd = float(potency["value_nM"])
    times, conc_nM = series
    occupancy = [(c * fu) / (c * fu + kd) if (c * fu + kd) > 0 else 0.0 for c in conc_nM]
    peak = max(occupancy) if occupancy else 0.0
    avg = sum(occupancy) / len(occupancy) if occupancy else 0.0
    above = (
        sum(1 for o in occupancy if o >= occupancy_threshold) / len(occupancy) if occupancy else 0.0
    )
    return {
        "available": True,
        "tissue": tissue,
        "kd_nM": kd,
        "peak_occupancy": round(peak, 4),
        "average_occupancy": round(avg, 4),
        "fraction_time_above_threshold": round(above, 4),
        "occupancy_threshold": occupancy_threshold,
        "occupancy_curve": {"time": times, "occupancy": [round(o, 5) for o in occupancy]},
        "model": "1:1 mass-action receptor occupancy from PBPK free-drug and BindingML Kd",
        "confidence": potency.get("provenance", "ml"),
        "provenance": f"derived (Kd: {potency.get('source', 'unknown')})",
        "limitations": (
            "Occupancy uses plasma free-drug as the biophase surrogate and an ML-predicted Kd; "
            "it is a target-engagement estimate, not an efficacy or PD-effect prediction. "
            "Tissue-specific free concentration would refine intracellular targets."
        ),
    }


def exposure_response(
    arm_result: dict[str, Any],
    potency: dict[str, Any] | None,
    *,
    tissue: str = "plasma",
) -> dict[str, Any]:
    """The three candidate PK/PD drivers, computed against the target potency.

    Antimicrobial and oncology pharmacology both turn on *which* exposure metric
    drives effect — peak (Cmax/IC50), total exposure (AUC/IC50), or duration
    (fraction of the interval above IC50). Which one applies is an experimental
    question, so all three are computed and none is asserted as the driver.
    """
    if not potency or not (potency.get("value_nM") and potency["value_nM"] > 0):
        return {
            "available": False,
            "reason": "No target potency is available to reference exposure against.",
        }
    mw = (arm_result.get("ivive") or {}).get("mw_g_per_mol")
    fu = (((arm_result.get("ivive") or {}).get("inputs") or {}).get("fu_plasma") or {}).get("value")
    series = _conc_series_nM(arm_result, tissue, mw) if mw else None
    if series is None or fu is None:
        return {
            "available": False,
            "reason": "Missing molecular weight, unbound fraction, or tissue curve.",
        }
    ic50_nM = float(potency["value_nM"])
    times, conc_nM = series
    free_nM = [c * float(fu) for c in conc_nM]
    if not free_nM or len(times) < 2:
        return {"available": False, "reason": "The concentration series is too short to integrate."}

    peak = max(free_nM)
    trough = min(free_nM[len(free_nM) // 2 :]) if len(free_nM) > 2 else min(free_nM)
    window = times[-1] - times[0]
    above = [t for t, c in zip(times, free_nM, strict=True) if c >= ic50_nM]
    frac_above = (len(above) / len(times)) if times else 0.0
    # Trapezoidal free AUC over the simulated window (nM·h).
    auc_free = sum(
        (free_nM[i] + free_nM[i + 1]) / 2.0 * (times[i + 1] - times[i])
        for i in range(len(times) - 1)
    )

    return {
        "available": True,
        "tissue": tissue,
        "potency_nM": ic50_nM,
        "potency_kind": potency.get("kind"),
        "free_cmax_nM": round(peak, 4),
        "free_ctrough_nM": round(trough, 4),
        "free_auc_nM_h": round(auc_free, 3),
        "drivers": {
            "peak_driven": {
                "metric": "free Cmax / IC50",
                "value": round(peak / ic50_nM, 4),
                "meets_unity": peak >= ic50_nM,
            },
            "exposure_driven": {
                "metric": "free AUC / (IC50 × window)",
                "value": round(auc_free / (ic50_nM * window), 4) if window > 0 else None,
                "meets_unity": bool(window > 0 and auc_free >= ic50_nM * window),
            },
            "time_driven": {
                "metric": "fraction of the simulated window with free C ≥ IC50",
                "value": round(frac_above, 4),
                "meets_unity": frac_above >= 0.5,
            },
        },
        "trough_coverage": {
            "free_ctrough_over_ic50": round(trough / ic50_nM, 4),
            "trough_above_ic50": trough >= ic50_nM,
        },
        "model": "Free-drug exposure referenced to the L1/L2 target potency",
        "confidence": potency.get("provenance", "ml"),
        "provenance": f"derived (potency: {potency.get('source', 'unknown')})",
        "limitations": (
            "Which metric actually drives effect is a pharmacological property that must be "
            "established experimentally; all three are reported and none is asserted. Free "
            "plasma concentration stands in for the biophase."
        ),
    }


def pkpd_summary(
    arm_results: list[dict[str, Any]],
    potency: dict[str, Any] | None,
) -> dict[str, Any]:
    """Assemble PK metrics per arm, dose-proportionality, and coverage per arm."""
    per_arm = []
    for arm in arm_results:
        if not arm.get("available"):
            per_arm.append({"arm": arm.get("arm"), "available": False, "reason": arm.get("reason")})
            continue
        per_arm.append(
            {
                "arm": arm.get("arm"),
                "pk_metrics": pk_metrics_for_arm(arm),
                "target_coverage": target_coverage(arm, potency),
                "exposure_response": exposure_response(arm, potency),
            }
        )
    return {
        "per_arm": per_arm,
        "dose_proportionality": dose_proportionality(arm_results),
    }


__all__ = [
    "pk_metrics_for_arm",
    "dose_proportionality",
    "target_coverage",
    "pkpd_summary",
]
