"""Dose escalation: the ladder, and how a 3+3 design actually behaves on it.

Two distinct things are computed here and kept distinct.

**The ladder** is arithmetic on the starting dose. The modified Fibonacci
sequence (Penta 1992; still the default in oncology Phase 1) multiplies each
step by 2.0, 1.65, 1.5, 1.33 and then 1.33 thereafter; a fixed-fold ladder
doubles. Neither is a model — they are conventions, and the module names which
one it applied.

**The operating characteristics** are a Monte-Carlo simulation of the 3+3
escalation rule against a stated dose–toxicity relationship. That relationship
is an *assumption supplied by the user*, not a prediction: no model in this
platform predicts the probability of a dose-limiting toxicity in humans. The
simulation answers "given this DLT curve, how does the design behave" — which is
the real question a protocol writer has, and it is answered exactly, by
enumeration over many replicate trials.

Nothing here invents a DLT rate. If none is supplied the operating
characteristics are returned as ``not_predicted`` with the reason.
"""

from __future__ import annotations

import random
from typing import Any

# Penta et al. (1992) — the modified Fibonacci escalation multipliers.
MODIFIED_FIBONACCI = (2.0, 1.65, 1.5, 1.33)
MODIFIED_FIBONACCI_TAIL = 1.33

SCHEMES: dict[str, dict[str, Any]] = {
    "modified_fibonacci": {
        "name": "Modified Fibonacci",
        "reference": "Penta et al. (1992); conventional oncology Phase 1 escalation",
    },
    "double": {
        "name": "Fixed 2-fold",
        "reference": "Conventional healthy-volunteer SAD escalation",
    },
    "fixed_fold": {
        "name": "Fixed user-specified fold",
        "reference": "Protocol-defined escalation increment",
    },
    "accelerated_titration": {
        "name": "Accelerated titration (single-patient cohorts until toxicity)",
        "reference": "Simon et al. (1997) J Natl Cancer Inst 89:1138",
    },
}


def build_ladder(
    starting_dose_mg: float,
    *,
    scheme: str = "modified_fibonacci",
    n_levels: int = 7,
    fold: float = 2.0,
    max_dose_mg: float | None = None,
) -> dict[str, Any]:
    """Build the planned dose ladder from the starting dose."""
    if not (starting_dose_mg and starting_dose_mg > 0):
        return {"available": False, "reason": "A positive starting dose is required."}
    n_levels = max(1, min(int(n_levels), 20))
    spec = SCHEMES.get(scheme) or SCHEMES["modified_fibonacci"]

    doses = [float(starting_dose_mg)]
    for i in range(1, n_levels):
        if scheme == "modified_fibonacci":
            step = (
                MODIFIED_FIBONACCI[i - 1]
                if i - 1 < len(MODIFIED_FIBONACCI)
                else MODIFIED_FIBONACCI_TAIL
            )
        elif scheme == "double":
            step = 2.0
        else:
            step = float(fold) if fold and fold > 1 else 2.0
        doses.append(doses[-1] * step)

    capped = False
    if max_dose_mg and max_dose_mg > 0:
        kept = [d for d in doses if d <= max_dose_mg]
        capped = len(kept) < len(doses)
        doses = kept or doses[:1]

    levels = [
        {
            "level": i + 1,
            "dose_total_mg": round(d, 5),
            "dose_mg_per_kg": round(d / 60.0, 7),
            "step_from_previous": (round(d / doses[i - 1], 3) if i else None),
            "fold_over_starting_dose": round(d / doses[0], 3),
        }
        for i, d in enumerate(doses)
    ]
    return {
        "available": True,
        "scheme": scheme,
        "scheme_name": spec["name"],
        "reference": spec["reference"],
        "starting_dose_total_mg": round(float(starting_dose_mg), 5),
        "n_levels": len(levels),
        "levels": levels,
        "capped_at_max_dose": capped,
        "max_dose_mg": max_dose_mg,
        "model": "Protocol escalation arithmetic (a convention, not a prediction)",
        "provenance": "study design",
        "limitations": (
            "The ladder is arithmetic. Whether each step is tolerated depends on the observed "
            "safety and PK data at the preceding level, which is why every escalation is "
            "gated by a safety review committee."
        ),
    }


def _simulate_three_plus_three(
    dlt_probabilities: list[float], *, n_trials: int, seed: int
) -> dict[str, Any]:
    """Monte-Carlo operating characteristics of the standard 3+3 rule.

    The rule, implemented exactly: enrol 3; if 0/3 DLTs escalate; if 1/3 expand
    to 6 and escalate only on 1/6; if ≥2 DLTs at any point stop and declare the
    previous level the MTD.
    """
    rng = random.Random(seed)
    n_levels = len(dlt_probabilities)
    mtd_counts = [0] * (n_levels + 1)  # index 0 = "no dose tolerated"
    patients_total = 0
    dlt_total = 0
    level_exposure = [0] * n_levels

    for _ in range(n_trials):
        mtd = 0
        for level in range(n_levels):
            p = dlt_probabilities[level]
            level_exposure[level] += 1
            first = sum(1 for _ in range(3) if rng.random() < p)
            patients_total += 3
            dlt_total += first
            if first == 0:
                mtd = level + 1
                continue
            if first == 1:
                second = sum(1 for _ in range(3) if rng.random() < p)
                patients_total += 3
                dlt_total += second
                if first + second <= 1:
                    mtd = level + 1
                    continue
            break
        mtd_counts[mtd] += 1

    return {
        "available": True,
        "design": "3+3 escalation",
        "n_simulated_trials": n_trials,
        "mtd_distribution": [
            {
                "level": i if i > 0 else None,
                "label": f"Level {i}" if i > 0 else "No dose declared tolerated",
                "probability": round(count / n_trials, 4),
            }
            for i, count in enumerate(mtd_counts)
        ],
        "mean_patients_per_trial": round(patients_total / n_trials, 2),
        "mean_dlts_per_trial": round(dlt_total / n_trials, 3),
        "probability_level_reached": [
            {"level": i + 1, "probability": round(level_exposure[i] / n_trials, 4)}
            for i in range(n_levels)
        ],
        "model": "Exact Monte-Carlo enumeration of the 3+3 decision rule",
        "provenance": "simulation over a user-supplied dose–toxicity assumption",
    }


def escalation_operating_characteristics(
    ladder: dict[str, Any],
    dlt_probabilities: list[float] | None,
    *,
    n_trials: int = 5000,
    seed: int = 42,
) -> dict[str, Any]:
    """3+3 operating characteristics for a supplied dose–toxicity relationship."""
    if not ladder.get("available"):
        return {"available": False, "reason": "No dose ladder to simulate."}
    if not dlt_probabilities:
        return {
            "available": False,
            "reason": (
                "No dose–toxicity relationship was supplied. This platform predicts hazard "
                "mechanisms, not human dose-limiting-toxicity rates, so the design's operating "
                "characteristics cannot be simulated without an explicit assumption."
            ),
            "how_to_enable": (
                "Supply one DLT probability per dose level (for example from a historical "
                "compound in the same class) to see how the 3+3 rule behaves against it."
            ),
        }
    n_levels = len(ladder["levels"])
    probs = [max(0.0, min(1.0, float(p))) for p in dlt_probabilities][:n_levels]
    if len(probs) < n_levels:
        probs += [probs[-1] if probs else 0.0] * (n_levels - len(probs))
    result = _simulate_three_plus_three(probs, n_trials=n_trials, seed=seed)
    result["assumed_dlt_probabilities"] = probs
    result["limitations"] = (
        "The DLT probabilities are an assumption supplied to the simulation, not a prediction. "
        "The operating characteristics are exact for that assumption and meaningless without it."
    )
    return result


__all__ = [
    "MODIFIED_FIBONACCI",
    "SCHEMES",
    "build_ladder",
    "escalation_operating_characteristics",
]
