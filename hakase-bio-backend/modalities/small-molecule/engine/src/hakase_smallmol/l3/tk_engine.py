"""Toxicokinetics — the exposure table that makes a tox study interpretable.

ICH S3A requires that a toxicology study report the systemic exposure achieved
at each dose level, because the finding-to-dose relationship is really a
finding-to-exposure relationship. This module builds that table from the
simulated cohort: per-arm Cmax and AUC with the inter-animal interval, the
dose-normalised exposure that reveals non-linearity, the accumulation expected
on repeat dosing, and the exposure multiples between dose groups.

Everything is read out of the cohort simulation. Sex differences, tissue-binding
differences, and metabolite exposure are *not* modelled and are declared as such
rather than approximated.
"""

from __future__ import annotations

import math
from typing import Any

from hakase_smallmol.l3.biodistribution_engine import accumulation_ratio
from hakase_smallmol.l3.pbpk_adapter import parse_frequency_h

# Dose-normalised AUC is judged non-linear when the spread across dose groups
# exceeds this fraction of the mean (a conventional 25% screening criterion).
NONLINEARITY_TOLERANCE = 0.25


def _median(block: Any) -> float | None:
    if isinstance(block, dict):
        v = block.get("median")
        if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
            return float(v)
    return None


def _interval(block: Any) -> list[float] | None:
    if not isinstance(block, dict):
        return None
    lo, hi = block.get("p05"), block.get("p95")
    if isinstance(lo, (int, float)) and isinstance(hi, (int, float)):
        return [round(float(lo), 5), round(float(hi), 5)]
    return None


def _cv_percent(block: Any) -> float | None:
    """Approximate inter-animal CV% from the cohort's 5th–95th percentile band.

    For an approximately log-normal exposure distribution the 5–95 span is
    3.29 standard deviations, so CV% ≈ (p95 − p05) / (3.29 · median) · 100.
    """
    if not isinstance(block, dict):
        return None
    lo, hi, med = block.get("p05"), block.get("p95"), block.get("median")
    if not all(isinstance(v, (int, float)) for v in (lo, hi, med)) or not med:
        return None
    return round((float(hi) - float(lo)) / (3.29 * float(med)) * 100.0, 1)


def compute_toxicokinetics(
    arm_results: list[dict[str, Any]],
    *,
    frequency: str | None = None,
    duration_h: float | None = None,
) -> dict[str, Any]:
    """The per-dose-group toxicokinetic exposure table plus its interpretation."""
    tau_h = None
    try:
        tau_h = parse_frequency_h(frequency)
    except ValueError:
        tau_h = None

    rows: list[dict[str, Any]] = []
    for arm in arm_results:
        if not arm.get("available"):
            continue
        info = arm.get("arm") or {}
        dose = info.get("dose_mg_per_kg")
        ep = ((arm.get("cohort") or {}).get("endpoints") or {}).get("plasma") or {}
        c_max = _median(ep.get("c_max"))
        auc = _median(ep.get("auc"))
        t_half = _median(ep.get("t_half"))
        row: dict[str, Any] = {
            "arm": info.get("label"),
            "dose_mg_per_kg": dose,
            "c_max_mg_per_l": round(c_max, 5) if c_max is not None else None,
            "c_max_interval": _interval(ep.get("c_max")),
            "c_max_cv_percent": _cv_percent(ep.get("c_max")),
            "t_max_h": _median(ep.get("t_max")),
            "auc_mg_h_per_l": round(auc, 5) if auc is not None else None,
            "auc_interval": _interval(ep.get("auc")),
            "auc_cv_percent": _cv_percent(ep.get("auc")),
            "t_half_h": round(t_half, 3) if t_half is not None else None,
            "cl_l_per_h": _median(ep.get("cl")),
            "vss_l_per_kg": _median(ep.get("vss")),
        }
        if dose and dose > 0:
            if auc is not None:
                row["dose_normalised_auc"] = round(auc / dose, 6)
            if c_max is not None:
                row["dose_normalised_cmax"] = round(c_max / dose, 6)
        row["accumulation"] = accumulation_ratio(t_half, tau_h)
        rows.append(row)

    if not rows:
        return {
            "available": False,
            "reason": "No dose group produced an exposure simulation.",
        }

    dn = [r["dose_normalised_auc"] for r in rows if r.get("dose_normalised_auc")]
    linearity: dict[str, Any]
    if len(dn) >= 2:
        mean_dn = sum(dn) / len(dn)
        spread = (max(dn) - min(dn)) / mean_dn if mean_dn else None
        linearity = {
            "available": True,
            "dose_normalised_auc_values": [round(v, 6) for v in dn],
            "relative_spread": round(spread, 4) if spread is not None else None,
            "tolerance": NONLINEARITY_TOLERANCE,
            "linear": bool(spread is not None and spread <= NONLINEARITY_TOLERANCE),
            "interpretation": (
                "Dose-normalised AUC is constant across dose groups — exposure is linear over "
                "the studied range."
                if (spread is not None and spread <= NONLINEARITY_TOLERANCE)
                else "Dose-normalised AUC varies across dose groups — exposure is non-linear "
                "over the studied range; confirm before selecting the high dose."
            ),
            "model": "Dose-normalised AUC comparison across arms (ICH S3A practice)",
            "provenance": "derived",
        }
    else:
        linearity = {
            "available": False,
            "reason": "At least two active dose groups are needed to judge exposure linearity.",
        }

    # Exposure multiples between consecutive dose groups — how much separation
    # the study design actually buys.
    multiples = []
    ordered = [r for r in rows if r.get("auc_mg_h_per_l")]
    ordered.sort(key=lambda r: r.get("dose_mg_per_kg") or 0.0)
    for lower, upper in zip(ordered, ordered[1:], strict=False):
        if lower["auc_mg_h_per_l"]:
            multiples.append(
                {
                    "from_arm": lower["arm"],
                    "to_arm": upper["arm"],
                    "dose_ratio": round(
                        (upper["dose_mg_per_kg"] or 0) / (lower["dose_mg_per_kg"] or 1), 3
                    ),
                    "auc_ratio": round(upper["auc_mg_h_per_l"] / lower["auc_mg_h_per_l"], 3),
                }
            )

    return {
        "available": True,
        "units": {
            "c_max": "mg/L",
            "auc": "mg·h/L (over the simulated window)",
            "t_half": "h",
            "cl": "L/h",
            "vss": "L/kg",
        },
        "schedule": {
            "frequency": frequency or "single dose",
            "dosing_interval_h": tau_h,
            "study_duration_h": duration_h,
            "n_doses": (
                max(1, int((duration_h or 24.0) / tau_h)) if (tau_h and duration_h) else 1
            ),
        },
        "per_arm": rows,
        "exposure_linearity": linearity,
        "dose_group_separation": multiples,
        "not_modelled": [
            {
                "item": "Sex differences in exposure",
                "reason": (
                    "The physiology store carries a sex-averaged reference individual; a "
                    "sex-split TK table would require sex-specific physiology and clearance."
                ),
            },
            {
                "item": "Metabolite exposure",
                "reason": (
                    "The PBPK model tracks parent drug only. Circulating-metabolite TK "
                    "(ICH M3(R2) MIST) requires metabolite identification and standards."
                ),
            },
            {
                "item": "Day-1 versus terminal-day comparison",
                "reason": (
                    "Accumulation is projected from linear superposition, not from a "
                    "time-dependent simulation with enzyme induction or auto-inhibition."
                ),
            },
        ],
        "model": "Hakase PBPK virtual cohort; ICH S3A toxicokinetic reporting structure",
        "provenance": "derived",
        "limitations": (
            "Exposure values are cohort medians with 5th–95th percentile intervals reflecting "
            "simulated inter-animal variability, not measured plasma concentrations. CV% is "
            "inferred from that interval under a log-normal assumption."
        ),
    }


__all__ = ["NONLINEARITY_TOLERANCE", "compute_toxicokinetics"]
