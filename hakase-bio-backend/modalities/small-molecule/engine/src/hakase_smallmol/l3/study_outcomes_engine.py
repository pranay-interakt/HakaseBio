"""The study-report rollup: what this study would measure, and where the risk is.

The toxicology engine reasons by *mechanism*. A study report is organised by
*procedure* — in-life observations, clinical pathology, organ weights,
macroscopic and microscopic pathology. This module transposes one into the
other, so the workspace can show a reader the same sections a study director
would sign, with each section pointing back at the mechanistic domains that put
it under scrutiny.

It also checks the submitted design against the guideline expectations (group
size, dose-group count, duration, control arm) and reports the terminal
procedures a study of this length would schedule.

Nothing here is a finding. Each section lists the parameters that will be
measured and flags which of them the mechanistic panel says to watch.
"""

from __future__ import annotations

from typing import Any

# OECD 407 (28-day) / 408 (90-day) rodent repeat-dose expectations.
GUIDELINE_EXPECTATIONS: tuple[dict[str, Any], ...] = (
    {
        "id": "oecd_407",
        "name": "OECD 407 — repeated-dose 28-day oral toxicity (rodent)",
        "min_duration_h": 28 * 24,
        "max_duration_h": 35 * 24,
        "animals_per_sex_per_group": 5,
        "min_dose_groups": 3,
        "control_required": True,
    },
    {
        "id": "oecd_408",
        "name": "OECD 408 — repeated-dose 90-day oral toxicity (rodent)",
        "min_duration_h": 90 * 24,
        "max_duration_h": 120 * 24,
        "animals_per_sex_per_group": 10,
        "min_dose_groups": 3,
        "control_required": True,
    },
    {
        "id": "drf",
        "name": "Dose-range-finding / non-GLP tolerability",
        "min_duration_h": 0,
        "max_duration_h": 14 * 24,
        "animals_per_sex_per_group": 3,
        "min_dose_groups": 2,
        "control_required": False,
    },
    {
        "id": "single_dose_pk",
        "name": "Single-dose toxicokinetic / PK study",
        "min_duration_h": 0,
        "max_duration_h": 72,
        "animals_per_sex_per_group": 3,
        "min_dose_groups": 1,
        "control_required": False,
    },
)

# Procedure sections a repeat-dose study reports, and the mechanistic domains
# that put each under heightened scrutiny.
SECTIONS: tuple[dict[str, Any], ...] = (
    {
        "id": "mortality",
        "name": "Mortality & moribundity",
        "schedule": "Twice daily",
        "parameters": ["Survival", "Moribund sacrifice criteria", "Time to death"],
        "driven_by": ["acute_systemic", "hepatotoxicity", "cardiotoxicity", "hematotoxicity"],
    },
    {
        "id": "clinical_observations",
        "name": "Clinical observations",
        "schedule": "Daily cage-side; weekly detailed (open-field) observation",
        "parameters": [
            "General appearance, posture, coat condition",
            "Activity, gait, tremor, convulsion",
            "Respiration pattern",
            "Salivation, lacrimation, piloerection",
            "Faeces and urine appearance",
        ],
        "driven_by": ["neurotoxicity", "respiratory", "acute_systemic"],
    },
    {
        "id": "body_weight_food",
        "name": "Body weight & food consumption",
        "schedule": "Body weight at randomisation then weekly; food consumption weekly",
        "parameters": [
            "Absolute body weight",
            "Body-weight gain versus concurrent control",
            "Food consumption (g/animal/day)",
            "Food efficiency",
        ],
        "driven_by": ["metabolic", "mitochondrial", "hepatotoxicity", "acute_systemic"],
    },
    {
        "id": "haematology",
        "name": "Haematology",
        "schedule": "Terminal; interim if the design includes a recovery cohort",
        "parameters": [
            "RBC, haemoglobin, haematocrit, MCV, MCH, MCHC",
            "Reticulocyte count",
            "WBC with five-part differential",
            "Platelet count",
            "PT, APTT, fibrinogen",
        ],
        "driven_by": ["hematotoxicity", "immunotoxicity"],
    },
    {
        "id": "clinical_chemistry",
        "name": "Clinical chemistry",
        "schedule": "Terminal",
        "parameters": [
            "ALT, AST, ALP, GGT, total bilirubin, bile acids",
            "Urea, creatinine, electrolytes (Na⁺, K⁺, Cl⁻, Ca²⁺, phosphate)",
            "Glucose, total cholesterol, triglycerides",
            "Total protein, albumin, globulin, A/G ratio",
            "Creatine kinase, lactate dehydrogenase",
        ],
        "driven_by": [
            "hepatotoxicity",
            "nephrotoxicity",
            "metabolic",
            "mitochondrial",
            "cardiotoxicity",
        ],
    },
    {
        "id": "urinalysis",
        "name": "Urinalysis",
        "schedule": "Terminal (overnight collection)",
        "parameters": [
            "Volume, specific gravity, pH",
            "Protein, glucose, ketones, blood",
            "Microscopic sediment (casts, cells, crystals)",
            "Kidney-injury biomarkers (KIM-1, clusterin, NGAL) where scheduled",
        ],
        "driven_by": ["nephrotoxicity"],
    },
    {
        "id": "organ_weights",
        "name": "Organ weights",
        "schedule": "Terminal necropsy — absolute and relative to body and brain weight",
        "parameters": [
            "Liver, kidneys, heart, lungs, spleen, thymus",
            "Brain, adrenals, thyroid/parathyroid",
            "Testes and epididymides / ovaries and uterus",
        ],
        "driven_by": [
            "hepatotoxicity",
            "nephrotoxicity",
            "cardiotoxicity",
            "endocrine_reproductive",
            "immunotoxicity",
            "hematotoxicity",
        ],
    },
    {
        "id": "macroscopic",
        "name": "Macroscopic pathology",
        "schedule": "Terminal necropsy, all animals",
        "parameters": [
            "Full external and internal examination",
            "Gross lesion description, location and size",
            "Site-of-administration examination",
        ],
        "driven_by": ["dermal_local", "carcinogenicity"],
    },
    {
        "id": "microscopic",
        "name": "Microscopic (histo)pathology",
        "schedule": "Control and high-dose groups in full; target organs at all dose levels",
        "parameters": [
            "Standard tissue list (≈45 tissues), H&E",
            "Peer-reviewed severity grading against concurrent control",
            "Special stains / electron microscopy where a mechanism requires it",
        ],
        "driven_by": [
            "hepatotoxicity",
            "nephrotoxicity",
            "cardiotoxicity",
            "neurotoxicity",
            "endocrine_reproductive",
            "immunotoxicity",
            "respiratory",
            "carcinogenicity",
        ],
    },
    {
        "id": "toxicokinetics",
        "name": "Toxicokinetics",
        "schedule": "Day 1 and terminal day sparse sampling in satellite animals",
        "parameters": [
            "Cmax, Tmax, AUC per dose group per sex",
            "Accumulation ratio (terminal day / day 1)",
            "Dose-normalised exposure across groups",
        ],
        "driven_by": [],
    },
    {
        "id": "safety_pharmacology",
        "name": "Safety pharmacology (core battery)",
        "schedule": "Standalone studies or integrated into the repeat-dose design",
        "parameters": [
            "Cardiovascular telemetry (blood pressure, heart rate, ECG intervals)",
            "Functional observational battery / modified Irwin screen",
            "Whole-body plethysmography",
        ],
        "driven_by": ["cardiotoxicity", "neurotoxicity", "respiratory"],
    },
)


def _design_conformance(
    *,
    duration_h: float,
    cohort_size: int,
    n_active_groups: int,
    has_control: bool,
) -> dict[str, Any]:
    """Match the submitted design to the closest guideline and report the gaps."""
    best = min(
        GUIDELINE_EXPECTATIONS,
        key=lambda g: (
            0
            if g["min_duration_h"] <= duration_h <= g["max_duration_h"]
            else min(abs(duration_h - g["min_duration_h"]), abs(duration_h - g["max_duration_h"]))
        ),
    )
    gaps: list[str] = []
    if cohort_size < best["animals_per_sex_per_group"]:
        gaps.append(
            f"{best['name']} expects at least {best['animals_per_sex_per_group']} animals per sex "
            f"per group; the design simulates {cohort_size} per group."
        )
    if n_active_groups < best["min_dose_groups"]:
        gaps.append(
            f"{best['name']} expects at least {best['min_dose_groups']} dose levels; the design "
            f"has {n_active_groups}."
        )
    if best["control_required"] and not has_control:
        gaps.append(
            f"{best['name']} requires a concurrent vehicle control group; none was specified. "
            "Findings cannot be graded without one."
        )
    if not (best["min_duration_h"] <= duration_h <= best["max_duration_h"]):
        gaps.append(
            f"The simulated duration ({duration_h:.0f} h) sits outside the {best['name']} window."
        )
    return {
        "closest_guideline": best["name"],
        "guideline_id": best["id"],
        "expectations": {
            "animals_per_sex_per_group": best["animals_per_sex_per_group"],
            "min_dose_groups": best["min_dose_groups"],
            "control_required": best["control_required"],
            "duration_window_h": [best["min_duration_h"], best["max_duration_h"]],
        },
        "submitted": {
            "cohort_size_per_group": cohort_size,
            "active_dose_groups": n_active_groups,
            "control_group_present": has_control,
            "duration_h": duration_h,
        },
        "conformant": not gaps,
        "gaps": gaps,
        "note": (
            "A conformance check on the study design only. It says nothing about GLP status, "
            "which is a facility and quality-system property, not a design property."
        ),
    }


def compute_study_outcomes(
    *,
    toxicology: dict[str, Any],
    study_summary: dict[str, Any],
    has_control: bool,
) -> dict[str, Any]:
    """Transpose the mechanistic hazard panel into study-report sections."""
    domains = {d["id"]: d for d in (toxicology or {}).get("domains", [])}

    sections: list[dict[str, Any]] = []
    for spec in SECTIONS:
        drivers = []
        for domain_id in spec["driven_by"]:
            domain = domains.get(domain_id)
            if not domain:
                continue
            level = domain["hazard_call"]["level"]
            if level in {"high", "moderate"}:
                drivers.append(
                    {
                        "domain": domain["name"],
                        "domain_id": domain_id,
                        "hazard_level": level,
                        "organ": domain.get("organ"),
                        "driving_endpoint": domain["hazard_call"].get("driving_endpoint"),
                        "probability": domain["hazard_call"].get("driving_probability"),
                    }
                )
        focus = [
            item
            for domain_id in spec["driven_by"]
            for item in _focus_items(domains.get(domain_id), spec["id"])
        ]
        sections.append(
            {
                "id": spec["id"],
                "name": spec["name"],
                "schedule": spec["schedule"],
                "parameters": spec["parameters"],
                "heightened_scrutiny": bool(drivers),
                "driven_by": drivers,
                "focus_parameters": sorted(set(focus)),
                "status": (
                    "watch" if any(d["hazard_level"] == "high" for d in drivers) else
                    ("monitor" if drivers else "standard")
                ),
            }
        )

    watch = [s for s in sections if s["status"] == "watch"]
    return {
        "available": bool(sections),
        "sections": sections,
        "design_conformance": _design_conformance(
            duration_h=float(study_summary.get("duration_h") or 0.0),
            cohort_size=int(study_summary.get("cohort_size") or 0),
            n_active_groups=len(study_summary.get("dose_groups_mg_kg") or []),
            has_control=has_control,
        ),
        "summary": {
            "n_sections": len(sections),
            "n_under_heightened_scrutiny": sum(1 for s in sections if s["heightened_scrutiny"]),
            "sections_to_watch": [s["name"] for s in watch],
        },
        "model": "Mechanism→procedure transposition over the L3 toxicology panel (OECD 407/408 structure)",
        "provenance": "derived",
        "limitations": (
            "This lists the procedures a study would run and which of their parameters the "
            "mechanistic panel says to watch. It contains no measured values, no incidences and "
            "no severity grades — those exist only once the study is run."
        ),
    }


def _focus_items(domain: dict[str, Any] | None, section_id: str) -> list[str]:
    """Pull the finding vocabulary a flagged domain contributes to this section."""
    if not domain or domain["hazard_call"]["level"] not in {"high", "moderate"}:
        return []
    findings = domain.get("anticipated_findings") or {}
    key = {
        "haematology": "clinical_pathology",
        "clinical_chemistry": "clinical_pathology",
        "urinalysis": "clinical_pathology",
        "organ_weights": "organ_weight",
        "microscopic": "histopathology",
        "macroscopic": "histopathology",
        "clinical_observations": "in_life",
        "body_weight_food": "in_life",
        "mortality": "in_life",
        "safety_pharmacology": "in_life",
    }.get(section_id)
    items = findings.get(key) if key else None
    return list(items) if isinstance(items, list) else []


def check_design_conformance(
    *,
    duration_h: float,
    cohort_size: int,
    n_active_groups: int,
    has_control: bool,
) -> dict[str, Any]:
    """Design conformance, callable *before* the study is simulated.

    The same check the study record carries, exposed on its own so the workspace
    can tell a user their design misses a guideline expectation while it is still
    cheap to change — rather than after paying for the cohort simulation.
    """
    return _design_conformance(
        duration_h=float(duration_h or 0.0),
        cohort_size=int(cohort_size or 0),
        n_active_groups=int(n_active_groups or 0),
        has_control=bool(has_control),
    )


__all__ = [
    "GUIDELINE_EXPECTATIONS",
    "SECTIONS",
    "check_design_conformance",
    "compute_study_outcomes",
]
