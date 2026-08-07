"""Exposure margins — the number a first-in-human protocol is actually judged on.

A dose-based margin (animal NOAEL mg/kg ÷ human dose mg/kg) is the weaker
comparison, because two species reaching the same dose can reach very different
exposures. ICH M3(R2) and modern review practice are exposure-based: the margin
is the animal point-of-departure **AUC** or **Cmax** divided by the projected
human AUC or Cmax at the clinical dose.

Both layers of this platform now produce the required quantities from the same
PBPK engine — animal exposure at the POD from L3, human exposure at each planned
dose from L4 — so the exposure-based margin is computed directly rather than
approximated. The dose-based margin is reported alongside for continuity with
the FDA (2005) calculation.

Target-organ and safety-pharmacology margins are computed where the underlying
potency exists, and explicitly withheld where it does not.
"""

from __future__ import annotations

from typing import Any

# Conventional expectations. Named and surfaced; not hidden thresholds.
TARGET_EXPOSURE_MARGIN = 10.0  # comfortable margin to the animal POD exposure
MINIMUM_EXPOSURE_MARGIN = 3.0  # below this the programme is exposure-limited
HERG_TARGET_MARGIN = 30.0  # ICH S7B free-Cmax margin to the hERG IC50


def _ratio(numerator: float | None, denominator: float | None) -> float | None:
    if not isinstance(numerator, (int, float)) or not isinstance(denominator, (int, float)):
        return None
    if denominator <= 0:
        return None
    return numerator / denominator


def _band(margin: float | None) -> str:
    if margin is None:
        return "not_computed"
    if margin >= TARGET_EXPOSURE_MARGIN:
        return "comfortable"
    if margin >= MINIMUM_EXPOSURE_MARGIN:
        return "modest"
    if margin >= 1.0:
        return "narrow"
    return "exceeded"


def compute_exposure_margins(
    *,
    human_exposures: dict[str, Any],
    animal_pod_exposure: dict[str, Any],
    animal_pod: dict[str, Any] | None,
    animal_species: str,
) -> dict[str, Any]:
    """Per-dose-level exposure and dose margins against the animal POD."""
    rows = [r for r in (human_exposures or {}).get("exposures", []) if r.get("available")]
    if not rows:
        return {
            "available": False,
            "reason": "No human dose level produced an exposure projection.",
        }
    if not (animal_pod_exposure or {}).get("available"):
        return {
            "available": False,
            "reason": (
                "No animal point-of-departure exposure was available from the preclinical "
                "study, so an exposure-based margin cannot be computed. The dose-based FDA "
                "calculation in the translation block is the only comparison available."
            ),
            "dose_margins": _dose_margins(rows, animal_pod),
        }

    pod_auc = animal_pod_exposure.get("auc_uM_h")
    pod_cmax = animal_pod_exposure.get("total_cmax_uM")
    pod_free_cmax = animal_pod_exposure.get("free_cmax_uM")
    pod_dose = animal_pod_exposure.get("dose_mg_per_kg")

    margins: list[dict[str, Any]] = []
    for row in rows:
        auc_margin = _ratio(pod_auc, row.get("auc_uM_h"))
        cmax_margin = _ratio(pod_cmax, row.get("cmax_uM"))
        free_margin = _ratio(pod_free_cmax, row.get("free_cmax_uM"))
        dose_margin = _ratio(pod_dose, row.get("dose_mg_per_kg"))
        worst = min(
            [m for m in (auc_margin, cmax_margin, free_margin) if m is not None], default=None
        )
        margins.append(
            {
                "dose_total_mg": row.get("dose_total_mg"),
                "dose_mg_per_kg": row.get("dose_mg_per_kg"),
                "human_auc_uM_h": row.get("auc_uM_h"),
                "human_cmax_uM": row.get("cmax_uM"),
                "human_free_cmax_uM": row.get("free_cmax_uM"),
                "auc_margin": round(auc_margin, 3) if auc_margin is not None else None,
                "cmax_margin": round(cmax_margin, 3) if cmax_margin is not None else None,
                "free_cmax_margin": round(free_margin, 3) if free_margin is not None else None,
                "dose_margin": round(dose_margin, 3) if dose_margin is not None else None,
                "limiting_margin": round(worst, 3) if worst is not None else None,
                "band": _band(worst),
            }
        )

    acceptable = [m for m in margins if m["limiting_margin"] and m["limiting_margin"] >= MINIMUM_EXPOSURE_MARGIN]
    highest_acceptable = (
        max(acceptable, key=lambda m: m["dose_total_mg"] or 0.0) if acceptable else None
    )
    return {
        "available": True,
        "animal_species": animal_species,
        "animal_pod": {
            "name": (animal_pod or {}).get("pod_name") or (animal_pod or {}).get("name"),
            "dose_mg_per_kg": pod_dose,
            "auc_uM_h": pod_auc,
            "total_cmax_uM": pod_cmax,
            "free_cmax_uM": pod_free_cmax,
        },
        "per_dose_level": margins,
        "thresholds": {
            "target": TARGET_EXPOSURE_MARGIN,
            "minimum": MINIMUM_EXPOSURE_MARGIN,
        },
        "highest_dose_with_acceptable_margin": highest_acceptable,
        "model": (
            "Exposure-based margin: animal point-of-departure exposure ÷ projected human "
            "exposure, both from the same PBPK engine (ICH M3(R2) practice)"
        ),
        "provenance": "derived",
        "limitations": (
            "Both exposures are projections, not measurements. The animal exposure is taken "
            "at the point-of-departure dose by linear extrapolation through the simulated "
            "dose–exposure calibration; the human exposure comes from an IVIVE-parameterised "
            "human PBPK run. Neither has been confirmed against measured plasma concentrations."
        ),
    }


def _dose_margins(rows: list[dict[str, Any]], animal_pod: dict[str, Any] | None) -> list[dict[str, Any]]:
    pod_dose = (animal_pod or {}).get("dose_mg_per_kg")
    return [
        {
            "dose_total_mg": r.get("dose_total_mg"),
            "dose_mg_per_kg": r.get("dose_mg_per_kg"),
            "dose_margin": (
                round(pod_dose / r["dose_mg_per_kg"], 3)
                if pod_dose and r.get("dose_mg_per_kg")
                else None
            ),
        }
        for r in rows
    ]


def compute_safety_pharmacology_margins(
    *,
    human_exposures: dict[str, Any],
    animal_safety_pharmacology: dict[str, Any],
) -> dict[str, Any]:
    """Cardiac margin at each human dose, and what measurement would close it."""
    rows = [r for r in (human_exposures or {}).get("exposures", []) if r.get("free_cmax_uM")]
    systems = {s.get("system"): s for s in (animal_safety_pharmacology or {}).get("systems", [])}
    cardio = systems.get("Cardiovascular") or {}
    per_dose = [
        {
            "dose_total_mg": r["dose_total_mg"],
            "human_free_cmax_uM": r["free_cmax_uM"],
            "required_herg_ic50_uM": round(r["free_cmax_uM"] * HERG_TARGET_MARGIN, 4),
        }
        for r in rows
    ]
    return {
        "available": bool(per_dose),
        "cardiovascular": {
            "herg_risk_class": cardio.get("herg_risk_class"),
            "herg_blocker_probability": cardio.get("herg_blocker_probability"),
            "herg_ic50_band_uM": cardio.get("herg_ic50_band_uM"),
            "target_margin": HERG_TARGET_MARGIN,
            "per_dose_level": per_dose,
            "statement": (
                "A measured patch-clamp hERG IC50 is required to state a numeric ICH S7B "
                "margin. The table gives the IC50 each clinical dose would need to clear the "
                f"{HERG_TARGET_MARGIN:.0f}× threshold."
            ),
        },
        "central_nervous_system": {
            "brain_plasma_auc_ratio": (systems.get("Central nervous system") or {}).get(
                "brain_plasma_auc_ratio"
            ),
            "assessment": (systems.get("Central nervous system") or {}).get("assessment"),
        },
        "respiratory": {
            "assessment": (systems.get("Respiratory") or {}).get("assessment"),
            "phospholipidosis_risk_class": (systems.get("Respiratory") or {}).get(
                "phospholipidosis_risk_class"
            ),
        },
        "model": "ICH S7B free-Cmax margin framework over the human PBPK projection",
        "provenance": "derived + ml",
        "limitations": (
            "The liability models return classes, not potencies, so no numeric ion-channel "
            "margin is asserted. The required-IC50 column is the threshold the in-vitro study "
            "must beat, which is a testable statement rather than a prediction."
        ),
    }


__all__ = [
    "HERG_TARGET_MARGIN",
    "MINIMUM_EXPOSURE_MARGIN",
    "TARGET_EXPOSURE_MARGIN",
    "compute_exposure_margins",
    "compute_safety_pharmacology_margins",
]
