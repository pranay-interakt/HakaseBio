"""Phase 1 protocol skeleton: SAD and MAD design with guideline-anchored rules.

The design decisions a first-in-human protocol has to make are largely
structural — cohort size, randomisation ratio, sentinel dosing, PK sampling
density, stopping rules, washout — and they follow directly from the compound's
projected half-life and risk profile. This module derives them from the human
PBPK projection rather than restating a template:

  • PK sampling schedule is built from the projected Tmax and terminal half-life
    (sampling through at least five half-lives, denser around Tmax);
  • the MAD washout and treatment duration are set from the projected time to
    steady state;
  • sentinel dosing and cohort staggering follow EMA (2017), which requires them
    for the first cohort of a first-in-human trial;
  • stopping rules are the guideline set, made explicit.
"""

from __future__ import annotations

import math
from typing import Any

# EMA/CHMP/SWP/28367/07 Rev.1 (2017) — first-in-human design expectations.
SENTINEL_COHORT_SIZE = 2  # one active, one placebo, dosed first
DEFAULT_SAD_COHORT = 8  # 6 active : 2 placebo
DEFAULT_MAD_COHORT = 12  # 9 active : 3 placebo
DEFAULT_ACTIVE_PLACEBO_RATIO = 3.0


def _projected_pk(human_exposures: dict[str, Any]) -> dict[str, Any]:
    """Median Tmax and terminal half-life across the simulated dose levels."""
    rows = [r for r in (human_exposures or {}).get("exposures", []) if r.get("available")]
    t_half = [r["t_half_h"] for r in rows if isinstance(r.get("t_half_h"), (int, float))]
    t_max = [r["tmax_h"] for r in rows if isinstance(r.get("tmax_h"), (int, float))]
    if not t_half or not t_max:
        return {"available": False, "reason": "No human half-life or Tmax was projected."}
    t_half.sort()
    t_max.sort()
    return {
        "available": True,
        "median_t_half_h": round(t_half[len(t_half) // 2], 3),
        "median_t_max_h": round(t_max[len(t_max) // 2], 3),
    }


def pk_sampling_schedule(t_max_h: float, t_half_h: float) -> dict[str, Any]:
    """Sampling times derived from the projected Tmax and half-life."""
    horizon = min(5.0 * t_half_h, 336.0)  # five half-lives, capped at 14 days
    times = {0.0}
    # Dense absorption phase: fractions of Tmax up to just past the peak.
    for f in (0.25, 0.5, 0.75, 1.0, 1.5, 2.0):
        t = t_max_h * f
        if t <= horizon:
            times.add(round(t, 2))
    # Elimination phase: one sample per half-life.
    for n in range(1, 6):
        t = t_max_h + n * t_half_h
        if t <= horizon:
            times.add(round(t, 2))
    times.add(round(horizon, 2))
    ordered = sorted(times)
    return {
        "available": True,
        "sampling_times_h": ordered,
        "n_samples": len(ordered),
        "horizon_h": round(horizon, 2),
        "basis": (
            f"Derived from a projected Tmax of {t_max_h:.2f} h and terminal half-life of "
            f"{t_half_h:.2f} h: dense sampling through the absorption phase, then one sample "
            "per half-life to five half-lives."
        ),
        "provenance": "derived",
        "note": (
            "Times are for the plasma PK profile. Urine collection intervals and any "
            "metabolite sampling must be added once the clearance route and metabolite "
            "profile are characterised."
        ),
    }


def design_sad(
    *,
    ladder: dict[str, Any],
    human_exposures: dict[str, Any],
    cohort_size: int = DEFAULT_SAD_COHORT,
) -> dict[str, Any]:
    """Single ascending dose design derived from the ladder and projected PK."""
    if not ladder.get("available"):
        return {"available": False, "reason": "No dose ladder was available."}
    pk = _projected_pk(human_exposures)
    n_placebo = max(1, round(cohort_size / (DEFAULT_ACTIVE_PLACEBO_RATIO + 1.0)))
    n_active = cohort_size - n_placebo

    washout = None
    if pk.get("available"):
        # Conventional washout of at least five half-lives between cohorts.
        washout = max(48.0, 5.0 * pk["median_t_half_h"])

    cohorts = []
    for level in ladder["levels"]:
        cohorts.append(
            {
                "cohort": level["level"],
                "dose_total_mg": level["dose_total_mg"],
                "dose_mg_per_kg": level["dose_mg_per_kg"],
                "n_total": cohort_size,
                "n_active": n_active,
                "n_placebo": n_placebo,
                "sentinel_dosing": level["level"] == 1,
                "sentinel_note": (
                    "First cohort: one active and one placebo subject dosed first, with at "
                    "least 24 h of observation before the remainder — EMA (2017) requirement."
                    if level["level"] == 1
                    else None
                ),
            }
        )

    return {
        "available": True,
        "design": "Single ascending dose (SAD), randomised, double-blind, placebo-controlled",
        "population": "Healthy adult volunteers unless the compound's toxicity profile precludes it",
        "cohorts": cohorts,
        "n_subjects_total": cohort_size * len(cohorts),
        "randomisation_ratio": f"{int(DEFAULT_ACTIVE_PLACEBO_RATIO)}:1 active:placebo",
        "sentinel_cohort_size": SENTINEL_COHORT_SIZE,
        "inter_cohort_washout_h": round(washout, 1) if washout else None,
        "pk_sampling": (
            pk_sampling_schedule(pk["median_t_max_h"], pk["median_t_half_h"])
            if pk.get("available")
            else {"available": False, "reason": pk.get("reason")}
        ),
        "projected_pk": pk,
        "model": "EMA (2017) first-in-human design structure over the human PBPK projection",
        "provenance": "study design + derived",
    }


def design_mad(
    *,
    ladder: dict[str, Any],
    human_exposures: dict[str, Any],
    cohort_size: int = DEFAULT_MAD_COHORT,
    frequency: str = "QD",
) -> dict[str, Any]:
    """Multiple ascending dose design, with duration set by time to steady state."""
    if not ladder.get("available"):
        return {"available": False, "reason": "No dose ladder was available."}
    pk = _projected_pk(human_exposures)
    if not pk.get("available"):
        return {"available": False, "reason": pk.get("reason")}

    t_half = pk["median_t_half_h"]
    # ~95% of steady state is reached at 4.32 half-lives; a MAD runs at least
    # that long, and conventionally no fewer than seven days.
    days_to_ss = (4.32 * t_half) / 24.0
    treatment_days = max(7, math.ceil(days_to_ss) + 2)
    n_placebo = max(1, round(cohort_size / (DEFAULT_ACTIVE_PLACEBO_RATIO + 1.0)))

    # MAD levels are conventionally a subset of the SAD ladder, capped below the
    # highest single dose shown to be tolerated.
    levels = ladder["levels"][: max(1, min(4, len(ladder["levels"])))]
    return {
        "available": True,
        "design": "Multiple ascending dose (MAD), randomised, double-blind, placebo-controlled",
        "dosing_frequency": frequency,
        "treatment_duration_days": treatment_days,
        "duration_basis": (
            f"A projected terminal half-life of {t_half:.2f} h puts 95% of steady state at "
            f"{days_to_ss:.1f} days; the design adds margin and observes at least one week."
        ),
        "cohorts": [
            {
                "cohort": level["level"],
                "dose_total_mg": level["dose_total_mg"],
                "n_total": cohort_size,
                "n_active": cohort_size - n_placebo,
                "n_placebo": n_placebo,
            }
            for level in levels
        ],
        "n_subjects_total": cohort_size * len(levels),
        "pk_sampling": {
            "day_1": pk_sampling_schedule(pk["median_t_max_h"], t_half),
            "steady_state_day": pk_sampling_schedule(pk["median_t_max_h"], t_half),
            "trough_sampling": "Pre-dose on every dosing day, to confirm steady state",
        },
        "projected_pk": pk,
        "model": "EMA (2017) MAD structure with duration derived from the projected half-life",
        "provenance": "study design + derived",
        "prerequisite": (
            "MAD dose levels may only be selected once the corresponding SAD level has been "
            "reviewed for safety and PK — the ladder shown here is a plan, not an authorisation."
        ),
    }


def stopping_rules(
    *, margins: dict[str, Any], toxicology_summary: dict[str, Any] | None
) -> dict[str, Any]:
    """Explicit escalation-stopping criteria, including exposure-based ones."""
    rules: list[dict[str, Any]] = [
        {
            "id": "dlt",
            "rule": "Any dose-limiting toxicity in ≥2 subjects within a cohort",
            "action": "Stop escalation; the previous dose level becomes the maximum tolerated dose.",
            "source": "Standard Phase 1 practice",
        },
        {
            "id": "serious_ae",
            "rule": "Any serious adverse event assessed as related to study drug",
            "action": "Suspend dosing pending safety-review-committee assessment.",
            "source": "EMA (2017) §5",
        },
        {
            "id": "exposure_cap",
            "rule": (
                "Projected or observed exposure reaching the animal point-of-departure exposure "
                f"(margin < {1.0:.0f}×), or falling below the {3.0:.0f}× minimum margin without "
                "an agreed justification"
            ),
            "action": "Stop escalation regardless of clinical tolerability.",
            "source": "ICH M3(R2); EMA (2017) exposure-based approach",
        },
        {
            "id": "qtc",
            "rule": "QTcF increase > 60 ms from baseline, or any absolute QTcF > 500 ms",
            "action": "Stop escalation; perform a dedicated cardiac assessment.",
            "source": "ICH E14 / S7B",
        },
        {
            "id": "hy_law",
            "rule": "ALT or AST > 3× ULN with total bilirubin > 2× ULN (Hy's law)",
            "action": "Stop dosing for that subject and suspend escalation.",
            "source": "FDA DILI guidance (2009)",
        },
        {
            "id": "target_saturation",
            "rule": "Predicted target occupancy plateaus with further dose increase",
            "action": "Escalate no further on pharmacological grounds; characterise the plateau.",
            "source": "EMA (2017) MABEL / pharmacology-guided escalation",
        },
    ]

    capped = None
    if (margins or {}).get("available"):
        highest = margins.get("highest_dose_with_acceptable_margin")
        if highest:
            capped = {
                "dose_total_mg": highest.get("dose_total_mg"),
                "limiting_margin": highest.get("limiting_margin"),
                "note": (
                    "The highest simulated dose that retains the minimum exposure margin to the "
                    "animal point of departure. Escalation beyond it requires an explicit "
                    "justification in the protocol."
                ),
            }

    hazards = (toxicology_summary or {}).get("high_hazard_domains") or []
    for hazard in hazards:
        rules.append(
            {
                "id": f"hazard_{hazard.lower().replace(' ', '_').replace('/', '_')}",
                "rule": f"Intensified monitoring for the flagged preclinical hazard: {hazard}",
                "action": (
                    "Add the corresponding clinical monitoring to the protocol and define a "
                    "stopping threshold for it."
                ),
                "source": "Layer-3 preclinical hazard panel",
            }
        )

    return {
        "available": True,
        "rules": rules,
        "exposure_cap": capped,
        "model": "Guideline stopping-rule set, extended by the preclinical hazard panel",
        "provenance": "regulatory practice + derived",
    }


__all__ = [
    "DEFAULT_MAD_COHORT",
    "DEFAULT_SAD_COHORT",
    "SENTINEL_COHORT_SIZE",
    "design_mad",
    "design_sad",
    "pk_sampling_schedule",
    "stopping_rules",
]
