"""Points of departure and reverse dosimetry — the bridge to a human dose.

A NOAEL is an *observed* quantity: the highest dose at which a study saw no
adverse effect. A simulation cannot observe anything, so this module does not
claim one. What it can do — and what the first-in-human layer actually needs —
is assemble every defensible **point of departure (POD)** the platform can
support, each with its own provenance and strength, plus the reverse-dosimetry
machinery that converts a concentration into the dose that produces it.

Reverse dosimetry (the httk / EPA "oral equivalent dose" pattern) is exact here
because the PBPK cohort already gives the dose→exposure map:

    AED [mg/kg] = C_target [µM] / (C_per_unit_dose [µM per mg/kg])

where ``C_per_unit_dose`` is read off the simulated arms. Any bioactive
concentration — a target IC50, a hERG IC50, a ToxCast AC50 — can therefore be
converted into the administered dose that reaches it, without a new model.

PODs assembled here
  ``evidence_noael``       measured in-vivo NOAEL located by the evidence engine
  ``allometric_noael``     that anchor scaled to the study species (FDA km)
  ``pharmacological_pod``  the dose achieving target-relevant free exposure,
                           from reverse dosimetry on the L1/L2 potency
  ``acute_anchor``         the predicted rat oral LD50 and its GHS band
  ``severity_limited_dose``the highest simulated dose, labelled for what it is
"""

from __future__ import annotations

import math
from typing import Any

from hakase_smallmol.l3.model_panel import ModelPanel, ld50_mg_per_kg


def _plasma_endpoint(arm: dict[str, Any], key: str) -> float | None:
    ep = ((arm.get("cohort") or {}).get("endpoints") or {}).get("plasma") or {}
    v = (ep.get(key) or {}).get("median")
    return float(v) if isinstance(v, (int, float)) and math.isfinite(v) else None


def build_dose_exposure_map(
    arm_results: list[dict[str, Any]], mw_g_per_mol: float | None
) -> dict[str, Any]:
    """Linear dose→exposure calibration read off the simulated arms.

    Returns the free and total plasma Cmax and AUC produced per mg/kg. Uses the
    arms themselves rather than a re-derivation, and reports the spread across
    arms so a non-linear dose–exposure relationship is visible rather than
    silently averaged away.
    """
    rows: list[dict[str, Any]] = []
    for arm in arm_results:
        if not arm.get("available"):
            continue
        dose = (arm.get("arm") or {}).get("dose_mg_per_kg")
        c_max = _plasma_endpoint(arm, "c_max")
        auc = _plasma_endpoint(arm, "auc")
        fu = (((arm.get("ivive") or {}).get("inputs") or {}).get("fu_plasma") or {}).get("value")
        if not (dose and dose > 0 and c_max and isinstance(fu, (int, float))):
            continue
        rows.append(
            {
                "arm": (arm.get("arm") or {}).get("label"),
                "dose_mg_per_kg": float(dose),
                "cmax_mg_per_l": c_max,
                "auc_mg_h_per_l": auc,
                "fu_plasma": float(fu),
            }
        )
    if not rows:
        return {"available": False, "reason": "No arm produced a usable dose–exposure pair."}
    if not (mw_g_per_mol and mw_g_per_mol > 0):
        return {
            "available": False,
            "reason": "Molecular weight is required to express exposure in µM.",
        }
    to_uM = 1000.0 / mw_g_per_mol
    per_dose_free = [r["cmax_mg_per_l"] * r["fu_plasma"] * to_uM / r["dose_mg_per_kg"] for r in rows]
    per_dose_total = [r["cmax_mg_per_l"] * to_uM / r["dose_mg_per_kg"] for r in rows]
    per_dose_auc = [
        (r["auc_mg_h_per_l"] * to_uM / r["dose_mg_per_kg"]) for r in rows if r["auc_mg_h_per_l"]
    ]
    mean_free = sum(per_dose_free) / len(per_dose_free)
    spread = (max(per_dose_free) - min(per_dose_free)) / mean_free if mean_free else 0.0
    return {
        "available": True,
        "free_cmax_uM_per_mg_kg": round(mean_free, 6),
        "total_cmax_uM_per_mg_kg": round(sum(per_dose_total) / len(per_dose_total), 6),
        "auc_uM_h_per_mg_kg": (
            round(sum(per_dose_auc) / len(per_dose_auc), 6) if per_dose_auc else None
        ),
        "relative_spread_across_arms": round(spread, 4),
        "linear_over_studied_range": spread <= 0.25,
        "calibration_points": rows,
        "model": "Linear dose–exposure calibration from the PBPK virtual cohort",
        "provenance": "derived",
        "limitations": (
            "Assumes proportionality between the calibrated arms. Where the relative spread "
            "exceeds 25% the dose–exposure relationship is non-linear and a single conversion "
            "factor should not be extrapolated beyond the simulated range."
        ),
    }


def administered_equivalent_dose(
    target_concentration_uM: float,
    dose_map: dict[str, Any],
    *,
    basis: str = "free_cmax",
) -> dict[str, Any]:
    """Reverse dosimetry: the mg/kg dose that reaches a target concentration."""
    if not dose_map.get("available"):
        return {"available": False, "reason": dose_map.get("reason")}
    key = {
        "free_cmax": "free_cmax_uM_per_mg_kg",
        "total_cmax": "total_cmax_uM_per_mg_kg",
        "auc": "auc_uM_h_per_mg_kg",
    }.get(basis)
    factor = dose_map.get(key) if key else None
    if not (isinstance(factor, (int, float)) and factor > 0):
        return {"available": False, "reason": f"No dose–exposure factor for basis {basis!r}."}
    if not (target_concentration_uM and target_concentration_uM > 0):
        return {"available": False, "reason": "A positive target concentration is required."}
    dose = target_concentration_uM / factor
    within = False
    points = dose_map.get("calibration_points") or []
    if points:
        doses = [p["dose_mg_per_kg"] for p in points]
        within = min(doses) <= dose <= max(doses)
    return {
        "available": True,
        "administered_equivalent_dose_mg_per_kg": round(dose, 5),
        "target_concentration_uM": target_concentration_uM,
        "basis": basis,
        "conversion_factor_uM_per_mg_kg": factor,
        "within_simulated_dose_range": within,
        "model": "Reverse dosimetry over the PBPK dose–exposure calibration (EPA/httk pattern)",
        "provenance": "derived",
        "extrapolation_note": (
            None
            if within
            else "The implied dose lies outside the simulated dose range; linearity beyond the "
            "calibrated arms is an assumption, not a result."
        ),
    }


def _pharmacological_pod(
    potency: dict[str, Any] | None,
    dose_map: dict[str, Any],
    *,
    occupancy_targets: tuple[float, ...] = (0.1, 0.5, 0.9),
) -> dict[str, Any]:
    """Doses achieving defined target occupancies, from potency + reverse dosimetry.

    For 1:1 mass action, occupancy θ is reached at free concentration
    ``C = Kd · θ/(1−θ)``. Converting each of those concentrations back through
    the dose–exposure map gives the pharmacologically anchored dose ladder that
    the MABEL calculation in the first-in-human layer consumes.
    """
    if not potency or not potency.get("value_nM"):
        return {
            "available": False,
            "reason": "No target potency (Ki/IC50/Kd) is available to anchor a pharmacological POD.",
        }
    kd_uM = float(potency["value_nM"]) / 1000.0
    rows = []
    for theta in occupancy_targets:
        conc = kd_uM * theta / (1.0 - theta)
        aed = administered_equivalent_dose(conc, dose_map, basis="free_cmax")
        rows.append(
            {
                "target_occupancy": theta,
                "required_free_concentration_uM": round(conc, 6),
                "dose_mg_per_kg": aed.get("administered_equivalent_dose_mg_per_kg"),
                "within_simulated_range": aed.get("within_simulated_dose_range"),
                "available": aed.get("available", False),
                "reason": aed.get("reason"),
            }
        )
    return {
        "available": any(r["available"] for r in rows),
        "kd_uM": kd_uM,
        "potency_provenance": potency.get("provenance"),
        "potency_source": potency.get("source"),
        "occupancy_ladder": rows,
        "model": (
            "Occupancy-anchored dose ladder: C = Kd·θ/(1−θ) (1:1 mass action) converted to "
            "dose by reverse dosimetry on the PBPK dose–exposure calibration"
        ),
        "provenance": "derived (potency provenance carried through)",
        "limitations": (
            "Uses free plasma concentration as the biophase surrogate and an ML-predicted "
            "affinity. This is a target-engagement anchor, not an efficacious dose."
        ),
    }


def compute_points_of_departure(
    *,
    panel: ModelPanel,
    arm_results: list[dict[str, Any]],
    safety: dict[str, Any],
    potency: dict[str, Any] | None,
    toxicology: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Assemble every defensible POD plus the reverse-dosimetry calibration."""
    dose_map = build_dose_exposure_map(arm_results, panel.mw_g_per_mol)
    anchors = (safety or {}).get("anchors") or {}
    evidence_noael = anchors.get("evidence_noael") or {}
    allometric = anchors.get("allometric_mtd_noael") or {}
    acute = ld50_mg_per_kg(panel)

    doses = [
        (a.get("arm") or {}).get("dose_mg_per_kg")
        for a in arm_results
        if a.get("available") and (a.get("arm") or {}).get("dose_mg_per_kg")
    ]
    highest = max(doses) if doses else None

    candidates: list[dict[str, Any]] = []
    if evidence_noael.get("value_mg_kg_day"):
        candidates.append(
            {
                "id": "evidence_noael",
                "name": "Measured in-vivo NOAEL (public evidence)",
                "dose_mg_per_kg": evidence_noael["value_mg_kg_day"],
                "species": ", ".join(evidence_noael.get("species_covered") or []) or None,
                "strength": "strong",
                "provenance": "measured",
                "source": evidence_noael.get("source"),
            }
        )
    if allometric.get("available"):
        candidates.append(
            {
                "id": "allometric_noael",
                "name": "Allometrically scaled NOAEL (study species)",
                "dose_mg_per_kg": allometric.get("estimated_noael_mg_kg_study_species"),
                "interval_mg_per_kg": allometric.get("interval_mg_kg"),
                "species": allometric.get("study_species"),
                "strength": "moderate",
                "provenance": "derived",
                "source": allometric.get("source"),
                "basis": allometric.get("basis"),
            }
        )
    pharm = _pharmacological_pod(potency, dose_map)
    if pharm.get("available"):
        half = next(
            (r for r in pharm["occupancy_ladder"] if r["target_occupancy"] == 0.5 and r["available"]),
            None,
        )
        if half:
            candidates.append(
                {
                    "id": "pharmacological_pod",
                    "name": "Pharmacologically active dose (50% target occupancy)",
                    "dose_mg_per_kg": half["dose_mg_per_kg"],
                    "strength": "moderate",
                    "provenance": "derived",
                    "source": pharm.get("potency_source"),
                    "basis": "Reverse dosimetry from the L1/L2 binding affinity",
                }
            )
    if acute.get("available"):
        candidates.append(
            {
                "id": "acute_ld50",
                "name": "Predicted acute oral LD50 (rat)",
                "dose_mg_per_kg": acute["ld50_mg_kg"],
                "strength": "weak",
                "provenance": "ml",
                "source": acute.get("model"),
                "basis": acute.get("ghs_category"),
                "note": (
                    "A lethality anchor, not a no-effect level. It bounds the top of a "
                    "dose-range-finding study; it must never be used as a POD for human "
                    "dose projection."
                ),
            }
        )
    if highest:
        candidates.append(
            {
                "id": "highest_simulated_dose",
                "name": "Highest dose simulated in this study",
                "dose_mg_per_kg": highest,
                "strength": "context only",
                "provenance": "study design",
                "note": (
                    "This is the top of the simulated range, not a demonstrated tolerated "
                    "dose. No adverse effect can be observed in a simulation."
                ),
            }
        )

    usable = [c for c in candidates if c["strength"] in {"strong", "moderate"} and c.get("dose_mg_per_kg")]
    preferred = min(usable, key=lambda c: c["dose_mg_per_kg"]) if usable else None

    # Exposure at the preferred POD, which the first-in-human layer needs for an
    # AUC-based rather than dose-based safety margin.
    pod_exposure: dict[str, Any] = {"available": False}
    if preferred and dose_map.get("available"):
        d = float(preferred["dose_mg_per_kg"])
        pod_exposure = {
            "available": True,
            "dose_mg_per_kg": d,
            "free_cmax_uM": round(d * dose_map["free_cmax_uM_per_mg_kg"], 6),
            "total_cmax_uM": round(d * dose_map["total_cmax_uM_per_mg_kg"], 6),
            "auc_uM_h": (
                round(d * dose_map["auc_uM_h_per_mg_kg"], 6)
                if dose_map.get("auc_uM_h_per_mg_kg")
                else None
            ),
            "basis": "Linear projection through the PBPK dose–exposure calibration",
            "provenance": "derived",
        }

    return {
        "available": bool(candidates),
        "dose_exposure_calibration": dose_map,
        "candidates": candidates,
        "preferred_pod": preferred,
        "preferred_pod_exposure": pod_exposure,
        "pharmacological_pod": pharm,
        "acute_anchor": acute,
        "noael_determination": {
            "determined": False,
            "reason": (
                "A NOAEL is an observed quantity — the highest dose at which a study saw no "
                "adverse effect. This layer simulates exposure and predicts hazard; it does not "
                "observe findings, so it reports candidate points of departure with their "
                "provenance instead of asserting a NOAEL."
            ),
            "what_would_establish_it": (
                "A dose-range-finding study followed by a GLP repeat-dose study in the study "
                "species, with clinical pathology, organ weights and histopathology read against "
                "concurrent controls."
            ),
            "hazard_context": (
                (toxicology or {}).get("summary", {}).get("high_hazard_domains") or []
            ),
        },
        "model": "POD assembly + reverse dosimetry over the PBPK dose–exposure calibration",
        "provenance": "mixed (measured evidence, derived allometry, derived reverse dosimetry)",
        "limitations": (
            "The preferred POD is the most conservative of the defensible anchors, not a "
            "regulatory NOAEL. Predicted LD50 is explicitly excluded from selection because a "
            "lethality endpoint cannot anchor a safe starting dose."
        ),
    }


__all__ = [
    "administered_equivalent_dose",
    "build_dose_exposure_map",
    "compute_points_of_departure",
]
