"""Starting-dose selection: NOAEL-based, MABEL, and the pharmacologically active dose.

EMA/CHMP/SWP/28367/07 Rev.1 is explicit that the NOAEL/HED route is not
sufficient on its own for compounds with an uncertain risk profile: the minimum
anticipated biological effect level (MABEL) must be derived from all available
pharmacology, and where the approaches disagree, **the lowest value governs**.

Three approaches are computed here, each from real inputs:

  NOAEL/HED   the L3 point of departure through the FDA (2005) BSA conversion
              and safety factor (``translation_engine``)
  MABEL       the human dose producing a defined low target occupancy, obtained
              by reverse dosimetry on the *human* PBPK dose–exposure map and the
              L1/L2 binding affinity
  PAD         the pharmacologically active dose — the human dose reaching the
              occupancy associated with pharmacological effect

Where the potency is missing, MABEL and PAD are returned as ``not_predicted``
and the module says so instead of falling back to the NOAEL route silently.
"""

from __future__ import annotations

from typing import Any

from hakase_smallmol.l4.translation_engine import REFERENCE_HUMAN_WEIGHT_KG

# EMA (2017) practice: MABEL is anchored at a low, deliberately conservative
# occupancy; the pharmacologically active dose at the level associated with
# effect. Both are surfaced, not hidden.
MABEL_OCCUPANCY = 0.10
PAD_OCCUPANCY = 0.50
# Additional factor applied to the MABEL-derived dose for in-vitro→in-vivo and
# interspecies uncertainty in the potency measurement (EMA 2017 §4.3).
MABEL_UNCERTAINTY_FACTOR = 10.0


def _human_dose_exposure_map(human_exposures: dict[str, Any]) -> dict[str, Any]:
    """Free-Cmax per mg of total dose, read off the simulated human arms."""
    rows = [
        r
        for r in (human_exposures or {}).get("exposures", [])
        if r.get("available") and r.get("free_cmax_uM") and r.get("dose_total_mg")
    ]
    if not rows:
        return {
            "available": False,
            "reason": (
                "No human dose level produced a free Cmax; a molecular weight and an unbound "
                "fraction are both required."
            ),
        }
    factors = [r["free_cmax_uM"] / r["dose_total_mg"] for r in rows]
    mean = sum(factors) / len(factors)
    spread = (max(factors) - min(factors)) / mean if mean else 0.0
    return {
        "available": True,
        "free_cmax_uM_per_mg": round(mean, 8),
        "relative_spread": round(spread, 4),
        "linear": spread <= 0.25,
        "calibration_doses_mg": [r["dose_total_mg"] for r in rows],
        "model": "Linear dose–exposure calibration from the human PBPK cohort",
        "provenance": "derived",
    }


def _occupancy_dose(
    potency: dict[str, Any] | None,
    dose_map: dict[str, Any],
    occupancy: float,
) -> dict[str, Any]:
    """Total human dose (mg) reaching a given 1:1 mass-action occupancy."""
    if not potency or not potency.get("value_nM"):
        return {
            "available": False,
            "reason": "No target potency (Ki/IC50/Kd) is available to anchor an occupancy dose.",
        }
    if not dose_map.get("available"):
        return {"available": False, "reason": dose_map.get("reason")}
    kd_uM = float(potency["value_nM"]) / 1000.0
    required_uM = kd_uM * occupancy / (1.0 - occupancy)
    dose_mg = required_uM / dose_map["free_cmax_uM_per_mg"]
    return {
        "available": True,
        "target_occupancy": occupancy,
        "kd_uM": kd_uM,
        "required_free_cmax_uM": round(required_uM, 8),
        "dose_total_mg": round(dose_mg, 5),
        "dose_mg_per_kg": round(dose_mg / REFERENCE_HUMAN_WEIGHT_KG, 7),
        "potency_provenance": potency.get("provenance"),
        "potency_source": potency.get("source"),
        "model": (
            "Occupancy anchor C = Kd·θ/(1−θ) (1:1 mass action) converted to dose by reverse "
            "dosimetry on the human PBPK dose–exposure calibration"
        ),
        "provenance": "derived",
    }


def compute_mabel(
    potency: dict[str, Any] | None,
    human_exposures: dict[str, Any],
    *,
    uncertainty_factor: float = MABEL_UNCERTAINTY_FACTOR,
) -> dict[str, Any]:
    """Minimum anticipated biological effect level, with its uncertainty factor."""
    dose_map = _human_dose_exposure_map(human_exposures)
    anchor = _occupancy_dose(potency, dose_map, MABEL_OCCUPANCY)
    if not anchor.get("available"):
        return {
            "available": False,
            "reason": anchor.get("reason"),
            "dose_exposure_calibration": dose_map,
        }
    dose = float(anchor["dose_total_mg"]) / uncertainty_factor
    return {
        "available": True,
        "mabel_total_mg": round(dose, 6),
        "mabel_mg_per_kg": round(dose / REFERENCE_HUMAN_WEIGHT_KG, 8),
        "anchor_occupancy": MABEL_OCCUPANCY,
        "anchor_dose_total_mg": anchor["dose_total_mg"],
        "uncertainty_factor": uncertainty_factor,
        "required_free_cmax_uM": anchor["required_free_cmax_uM"],
        "kd_uM": anchor["kd_uM"],
        "potency_provenance": anchor.get("potency_provenance"),
        "potency_source": anchor.get("potency_source"),
        "dose_exposure_calibration": dose_map,
        "model": (
            f"EMA (2017) MABEL: dose achieving {MABEL_OCCUPANCY:.0%} target occupancy in the "
            f"human PBPK projection, divided by an uncertainty factor of {uncertainty_factor:g}"
        ),
        "provenance": "derived (potency provenance carried through)",
        "limitations": (
            "Uses free plasma concentration as the biophase surrogate and an ML-predicted "
            "affinity rather than a measured human-target Ki with a concentration–response "
            "curve. EMA expects MABEL to integrate all pharmacology data, including functional "
            "potency in a human primary-cell system, which this platform does not hold."
        ),
    }


def compute_pharmacologically_active_dose(
    potency: dict[str, Any] | None, human_exposures: dict[str, Any]
) -> dict[str, Any]:
    """The human dose expected to produce pharmacological effect."""
    dose_map = _human_dose_exposure_map(human_exposures)
    anchor = _occupancy_dose(potency, dose_map, PAD_OCCUPANCY)
    if not anchor.get("available"):
        return {"available": False, "reason": anchor.get("reason")}
    return {
        **anchor,
        "available": True,
        "pad_total_mg": anchor["dose_total_mg"],
        "pad_mg_per_kg": anchor["dose_mg_per_kg"],
        "limitations": (
            "Target engagement is a necessary but not sufficient condition for efficacy. This "
            "is not an efficacious-dose prediction."
        ),
    }


def recommend_starting_dose(
    *,
    translations: dict[str, Any],
    mabel: dict[str, Any],
    pad: dict[str, Any],
    risk_profile: str = "standard",
) -> dict[str, Any]:
    """Reconcile the approaches; the lowest defensible dose governs."""
    approaches: list[dict[str, Any]] = []

    governing = (translations or {}).get("governing_mrsd") or {}
    mrsd = (governing.get("mrsd") or {}) if governing else {}
    if mrsd.get("available"):
        approaches.append(
            {
                "id": "noael_hed",
                "name": "NOAEL / HED with safety factor (FDA 2005)",
                "dose_total_mg": mrsd["mrsd_total_mg_60kg"],
                "dose_mg_per_kg": mrsd["mrsd_mg_per_kg"],
                "basis": governing.get("pod_name"),
                "strength": governing.get("pod_strength"),
                "provenance": "regulatory calculation over a "
                + str(governing.get("pod_provenance") or "derived")
                + " point of departure",
                "available": True,
            }
        )
    else:
        approaches.append(
            {
                "id": "noael_hed",
                "name": "NOAEL / HED with safety factor (FDA 2005)",
                "available": False,
                "reason": (
                    "No point of departure rated strong or moderate was available to "
                    "translate. A dose-range-finding study is the gating measurement."
                ),
            }
        )

    if mabel.get("available"):
        approaches.append(
            {
                "id": "mabel",
                "name": "MABEL (EMA 2017)",
                "dose_total_mg": mabel["mabel_total_mg"],
                "dose_mg_per_kg": mabel["mabel_mg_per_kg"],
                "basis": f"{MABEL_OCCUPANCY:.0%} target occupancy ÷ {mabel['uncertainty_factor']:g}",
                "provenance": "derived",
                "available": True,
            }
        )
    else:
        approaches.append(
            {"id": "mabel", "name": "MABEL (EMA 2017)", "available": False, "reason": mabel.get("reason")}
        )

    if pad.get("available"):
        approaches.append(
            {
                "id": "pad",
                "name": "Pharmacologically active dose",
                "dose_total_mg": pad["pad_total_mg"],
                "dose_mg_per_kg": pad["pad_mg_per_kg"],
                "basis": f"{PAD_OCCUPANCY:.0%} target occupancy",
                "provenance": "derived",
                "available": True,
                "role": "context — the target the escalation is climbing toward, not a starting dose",
            }
        )

    candidates = [
        a for a in approaches if a.get("available") and a["id"] in {"noael_hed", "mabel"}
    ]
    if not candidates:
        return {
            "available": False,
            "reason": (
                "Neither the NOAEL/HED route nor MABEL could be computed, so no starting dose "
                "can be recommended. Obtain an in-vivo point of departure or a measured target "
                "affinity."
            ),
            "approaches": approaches,
        }
    governing_approach = min(candidates, key=lambda a: a["dose_total_mg"])
    disagreement = None
    if len(candidates) > 1:
        hi = max(candidates, key=lambda a: a["dose_total_mg"])
        ratio = hi["dose_total_mg"] / governing_approach["dose_total_mg"]
        disagreement = {
            "fold_difference": round(ratio, 2),
            "lower_approach": governing_approach["name"],
            "higher_approach": hi["name"],
            "note": (
                "The approaches agree closely."
                if ratio <= 3
                else (
                    f"The approaches differ by {ratio:.0f}-fold. EMA guidance requires the lower "
                    "value to govern and the divergence to be justified in the protocol."
                )
            ),
        }

    return {
        "available": True,
        "recommended_starting_dose_total_mg": governing_approach["dose_total_mg"],
        "recommended_starting_dose_mg_per_kg": governing_approach["dose_mg_per_kg"],
        "governing_approach": governing_approach["id"],
        "governing_approach_name": governing_approach["name"],
        "approaches": approaches,
        "approach_disagreement": disagreement,
        "risk_profile": risk_profile,
        "reference_human_weight_kg": REFERENCE_HUMAN_WEIGHT_KG,
        "model": "EMA (2017) integrated starting-dose selection — lowest defensible approach governs",
        "provenance": "regulatory calculation over derived inputs",
        "limitations": (
            "A computed recommendation for protocol design, not a regulatory submission. The "
            "actual starting dose must be justified against the full nonclinical package, "
            "including the in-vivo studies this platform models but does not run."
        ),
    }


__all__ = [
    "MABEL_OCCUPANCY",
    "MABEL_UNCERTAINTY_FACTOR",
    "PAD_OCCUPANCY",
    "compute_mabel",
    "compute_pharmacologically_active_dose",
    "recommend_starting_dose",
]
