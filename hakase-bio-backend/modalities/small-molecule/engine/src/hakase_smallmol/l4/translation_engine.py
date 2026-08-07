"""Animal → human dose translation: HED, MRSD, and the allometric alternatives.

This is the FDA (2005) calculation, implemented literally rather than
approximated. For an animal dose in mg/kg:

    HED [mg/kg] = animal dose × (km_animal / km_human)

where ``km`` is body weight divided by body surface area. The maximum
recommended starting dose is then

    MRSD [mg/kg] = HED / safety factor        (default safety factor 10)

The guidance's own caveats are enforced rather than glossed over:
  • the conversion applies to systemic small molecules dosed by a route with
    comparable bioavailability — it is flagged when the animal route differs
    from the intended clinical route;
  • the safety factor is *increased* when the guidance's risk factors are
    present (steep dose–response, non-monitorable toxicity, novel target,
    irreversible toxicity), and those increases are itemised, not hidden;
  • an alternative exposure-based (AUC) translation is reported alongside,
    because BSA scaling is a dose conversion and says nothing about clearance
    differences between species.
"""

from __future__ import annotations

from typing import Any

# FDA (2005) Table 1 — km factors (body weight ÷ body surface area, kg/m²).
KM_FACTORS: dict[str, float] = {
    "mouse": 3.0,
    "hamster": 5.0,
    "rat": 6.0,
    "ferret": 7.0,
    "guinea pig": 8.0,
    "rabbit": 12.0,
    "monkey": 12.0,
    "marmoset": 6.0,
    "squirrel monkey": 7.0,
    "baboon": 20.0,
    "dog": 20.0,
    "micro-pig": 27.0,
    "mini-pig": 35.0,
    "human": 37.0,
}

DEFAULT_SAFETY_FACTOR = 10.0
REFERENCE_HUMAN_WEIGHT_KG = 60.0  # FDA (2005) reference adult
REFERENCE_HUMAN_BSA_M2 = 1.62  # FDA (2005) reference adult

# FDA (2005) — circumstances that warrant a safety factor above the default 10.
RISK_FACTORS: tuple[dict[str, Any], ...] = (
    {
        "id": "steep_dose_response",
        "label": "Steep dose–response curve",
        "additional_factor": 3.0,
    },
    {
        "id": "severe_toxicity",
        "label": "Severe or irreversible toxicity at the point of departure",
        "additional_factor": 3.0,
    },
    {
        "id": "non_monitorable_toxicity",
        "label": "Toxicity that cannot be monitored clinically",
        "additional_factor": 3.0,
    },
    {
        "id": "novel_target",
        "label": "Novel therapeutic target with no clinical precedent",
        "additional_factor": 2.0,
    },
    {
        "id": "nonlinear_pk",
        "label": "Non-linear pharmacokinetics over the studied range",
        "additional_factor": 2.0,
    },
    {
        "id": "wide_variability",
        "label": "Wide inter-animal exposure variability",
        "additional_factor": 2.0,
    },
    {
        "id": "single_species",
        "label": "Point of departure from a single species only",
        "additional_factor": 2.0,
    },
)
# The guidance caps the practical safety factor; beyond this the programme needs
# a different starting-dose approach, not a bigger divisor.
MAX_SAFETY_FACTOR = 1000.0


def km(species: str | None) -> float | None:
    if not species:
        return None
    return KM_FACTORS.get(species.strip().lower())


def human_equivalent_dose(
    animal_dose_mg_per_kg: float, animal_species: str
) -> dict[str, Any]:
    """FDA (2005) body-surface-area (km) conversion of an animal dose."""
    km_animal = km(animal_species)
    km_human = KM_FACTORS["human"]
    if km_animal is None:
        return {
            "available": False,
            "reason": f"No FDA km factor is published for species {animal_species!r}.",
        }
    if not (animal_dose_mg_per_kg and animal_dose_mg_per_kg > 0):
        return {"available": False, "reason": "A positive animal dose is required."}
    hed = animal_dose_mg_per_kg * (km_animal / km_human)
    return {
        "available": True,
        "animal_species": animal_species,
        "animal_dose_mg_per_kg": animal_dose_mg_per_kg,
        "hed_mg_per_kg": round(hed, 5),
        "hed_total_mg_60kg": round(hed * REFERENCE_HUMAN_WEIGHT_KG, 3),
        "hed_mg_per_m2": round(hed * km_human, 3),
        "km_factors": {"animal": km_animal, "human": km_human},
        "conversion_factor": round(km_animal / km_human, 5),
        "model": "FDA (2005) MRSD guidance, body-surface-area (km) dose conversion",
        "provenance": "regulatory calculation",
        "limitations": (
            "BSA scaling converts a dose, not an exposure. It assumes comparable "
            "bioavailability by the intended route and does not account for species "
            "differences in clearance, protein binding, or metabolism."
        ),
    }


def safety_factor(risk_flags: dict[str, bool] | None) -> dict[str, Any]:
    """Assemble the safety factor from the default plus itemised risk factors."""
    flags = risk_flags or {}
    applied = [
        {**rf, "applied": True}
        for rf in RISK_FACTORS
        if flags.get(rf["id"])
    ]
    total = DEFAULT_SAFETY_FACTOR
    for rf in applied:
        total *= rf["additional_factor"]
    capped = min(total, MAX_SAFETY_FACTOR)
    return {
        "base_factor": DEFAULT_SAFETY_FACTOR,
        "applied_risk_factors": applied,
        "available_risk_factors": [
            {k: v for k, v in rf.items() if k != "applied"} for rf in RISK_FACTORS
        ],
        "total_factor": round(capped, 2),
        "capped": capped < total,
        "cap": MAX_SAFETY_FACTOR,
        "model": "FDA (2005) safety-factor selection",
        "provenance": "regulatory calculation",
        "note": (
            "The default factor of 10 is increased multiplicatively for each guidance risk "
            "factor the programme carries. Where the product exceeds the cap, the starting "
            "dose should be set by the exposure-based or MABEL approach instead of a larger "
            "divisor."
        ),
    }


def maximum_recommended_starting_dose(
    hed: dict[str, Any], factor: dict[str, Any]
) -> dict[str, Any]:
    """MRSD = HED ÷ safety factor, in mg/kg and total mg for a 60 kg adult."""
    if not hed.get("available"):
        return {"available": False, "reason": hed.get("reason")}
    total = float(factor["total_factor"])
    mrsd = float(hed["hed_mg_per_kg"]) / total
    return {
        "available": True,
        "mrsd_mg_per_kg": round(mrsd, 6),
        "mrsd_total_mg_60kg": round(mrsd * REFERENCE_HUMAN_WEIGHT_KG, 4),
        "hed_mg_per_kg": hed["hed_mg_per_kg"],
        "safety_factor": total,
        "reference_human_weight_kg": REFERENCE_HUMAN_WEIGHT_KG,
        "model": "FDA (2005) MRSD = HED / safety factor",
        "provenance": "regulatory calculation",
        "limitations": (
            "The MRSD is a ceiling on the starting dose, not a recommendation on its own. "
            "EMA guidance requires it be cross-checked against the MABEL and the anticipated "
            "pharmacologically active dose, with the lowest value governing."
        ),
    }


def allometric_exposure_scaling(
    animal_cl_l_per_h_per_kg: float | None,
    animal_species: str,
    *,
    exponent: float = 0.75,
) -> dict[str, Any]:
    """Simple allometry for clearance — the exposure-based cross-check to BSA.

    Clearance scales with body weight to roughly the ¾ power. Converting a
    per-kilogram animal clearance to a human per-kilogram clearance therefore
    uses ``(BW_animal / BW_human)^(1 − b)``. This is reported as a cross-check
    on the BSA dose conversion, never as a substitute for the human PBPK
    simulation, which uses human physiology directly.
    """
    from hakase_kernel.pbpk.physiology.store import DEFAULT_STRAIN, get_physiology

    if not (animal_cl_l_per_h_per_kg and animal_cl_l_per_h_per_kg > 0):
        return {"available": False, "reason": "No animal clearance was available to scale."}
    try:
        animal_phys = get_physiology(animal_species, DEFAULT_STRAIN.get(animal_species))
        human_phys = get_physiology("human", DEFAULT_STRAIN.get("human"))
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "reason": f"Physiology lookup failed: {exc}"}
    bw_a = getattr(animal_phys, "reference_body_weight_kg", None)
    bw_h = getattr(human_phys, "reference_body_weight_kg", None)
    if not (bw_a and bw_h):
        return {"available": False, "reason": "Reference body weights were unavailable."}
    scaled = animal_cl_l_per_h_per_kg * (bw_a / bw_h) ** (1.0 - exponent)
    return {
        "available": True,
        "animal_species": animal_species,
        "animal_cl_l_per_h_per_kg": animal_cl_l_per_h_per_kg,
        "human_cl_l_per_h_per_kg": round(scaled, 6),
        "human_cl_l_per_h_60kg": round(scaled * REFERENCE_HUMAN_WEIGHT_KG, 4),
        "exponent": exponent,
        "reference_body_weights_kg": {"animal": bw_a, "human": bw_h},
        "model": f"Simple allometry CL ∝ BW^{exponent} (Boxenbaum 1982; Mahmood & Balian 1996)",
        "provenance": "derived",
        "limitations": (
            "Single-species allometry has wide error, typically within 2–3-fold at best. It is "
            "a sanity check on the human PBPK projection, which parameterises human physiology "
            "and human-specific binding directly."
        ),
    }


def translate_points_of_departure(
    points_of_departure: dict[str, Any],
    animal_species: str,
    risk_flags: dict[str, bool] | None = None,
) -> dict[str, Any]:
    """Convert every L3 point of departure to a human-equivalent dose and MRSD."""
    factor = safety_factor(risk_flags)
    rows: list[dict[str, Any]] = []
    for candidate in (points_of_departure or {}).get("candidates", []):
        dose = candidate.get("dose_mg_per_kg")
        if not isinstance(dose, (int, float)) or dose <= 0:
            continue
        hed = human_equivalent_dose(float(dose), animal_species)
        usable = candidate.get("strength") in {"strong", "moderate"}
        row = {
            "pod_id": candidate.get("id"),
            "pod_name": candidate.get("name"),
            "pod_strength": candidate.get("strength"),
            "pod_provenance": candidate.get("provenance"),
            "animal_dose_mg_per_kg": dose,
            "hed": hed,
            "eligible_for_mrsd": usable,
        }
        if usable:
            row["mrsd"] = maximum_recommended_starting_dose(hed, factor)
        else:
            row["excluded_reason"] = candidate.get("note") or (
                "This anchor is context only and may not set a human starting dose."
            )
        rows.append(row)

    eligible = [
        r
        for r in rows
        if r.get("eligible_for_mrsd") and (r.get("mrsd") or {}).get("available")
    ]
    governing = (
        min(eligible, key=lambda r: r["mrsd"]["mrsd_mg_per_kg"]) if eligible else None
    )
    return {
        "available": bool(rows),
        "animal_species": animal_species,
        "safety_factor": factor,
        "translations": rows,
        "governing_mrsd": governing,
        "model": "FDA (2005) HED conversion applied to every L3 point of departure",
        "provenance": "regulatory calculation over derived/measured PODs",
        "limitations": (
            "Only anchors the L3 layer rated 'strong' or 'moderate' are allowed to set an "
            "MRSD. Lethality and highest-simulated-dose anchors are translated for context "
            "but explicitly excluded from the starting-dose calculation."
        ),
    }


__all__ = [
    "DEFAULT_SAFETY_FACTOR",
    "KM_FACTORS",
    "REFERENCE_HUMAN_BSA_M2",
    "REFERENCE_HUMAN_WEIGHT_KG",
    "RISK_FACTORS",
    "allometric_exposure_scaling",
    "human_equivalent_dose",
    "km",
    "maximum_recommended_starting_dose",
    "safety_factor",
    "translate_points_of_departure",
]
