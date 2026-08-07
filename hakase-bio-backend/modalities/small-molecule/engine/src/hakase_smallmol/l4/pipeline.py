"""L4 orchestrator — turn a completed animal study into a first-in-human plan.

Ingest the L3 study record → translate every point of departure → project human
exposure at the candidate doses → derive MABEL and the pharmacologically active
dose → reconcile into a starting dose → build the escalation ladder and re-project
exposure on it → compute exposure margins → design SAD/MAD → gather clinical
precedent → gate → report → persist.

Every engine is a real computation. The orchestrator only sequences them and
threads their outputs into one provenance-stamped projection record.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from hakase_smallmol.l4 import SCHEMA_VERSION
from hakase_smallmol.l4.benefit_risk_engine import assess_benefit_risk
from hakase_smallmol.l4.decision_engine import first_in_human_gate
from hakase_smallmol.l4.escalation_engine import (
    build_ladder,
    escalation_operating_characteristics,
)
from hakase_smallmol.l4.human_pbpk_engine import project_human_exposures
from hakase_smallmol.l4.ind_gate_engine import evaluate_ind_gate
from hakase_smallmol.l4.margin_engine import (
    compute_exposure_margins,
    compute_safety_pharmacology_margins,
)
from hakase_smallmol.l4.reporting_engine import assemble_report
from hakase_smallmol.l4.starting_dose_engine import (
    compute_mabel,
    compute_pharmacologically_active_dose,
    recommend_starting_dose,
)
from hakase_smallmol.l4.store import put_projection
from hakase_smallmol.l4.substudy_engine import assess_sub_studies
from hakase_smallmol.l4.translation_engine import (
    REFERENCE_HUMAN_WEIGHT_KG,
    allometric_exposure_scaling,
    translate_points_of_departure,
)
from hakase_smallmol.l4.trial_design_engine import (
    DEFAULT_MAD_COHORT,
    DEFAULT_SAD_COHORT,
    design_mad,
    design_sad,
    stopping_rules,
)

# Doses used to calibrate the human dose–exposure relationship before the
# starting dose is known. They span three orders of magnitude so the reverse
# dosimetry has a wide, linear calibration to interpolate on.
CALIBRATION_DOSES_MG = (1.0, 10.0, 100.0)


def _potency_from_study(study: dict[str, Any]) -> dict[str, Any] | None:
    return ((study.get("resolved_inputs") or {}).get("potency")) or None


def _mw_from_study(study: dict[str, Any]) -> float | None:
    mw = (study.get("model_panel") or {}).get("mw_g_per_mol")
    if isinstance(mw, (int, float)):
        return float(mw)
    for arm in study.get("arms", []) or []:
        candidate = (arm.get("ivive") or {}).get("mw_g_per_mol")
        if isinstance(candidate, (int, float)):
            return float(candidate)
    return None


def _ml_inputs_from_study(study: dict[str, Any]) -> dict[str, float] | None:
    """Reuse the L1 ADMET handoff so human IVIVE matches the animal run's inputs."""
    for arm in study.get("arms", []) or []:
        supplied = ((arm.get("ivive") or {}).get("supplied_inputs")) or None
        if isinstance(supplied, dict) and supplied:
            return {k: v for k, v in supplied.items() if isinstance(v, (int, float))}
    return None


def run_first_in_human(
    *,
    study: dict[str, Any],
    route: str = "ORAL",
    formulation: str = "standard",
    frequency: str | None = None,
    duration_h: float = 168.0,
    cohort_size: int = 20,
    body_weight_kg: float = REFERENCE_HUMAN_WEIGHT_KG,
    risk_flags: dict[str, bool] | None = None,
    escalation_scheme: str = "modified_fibonacci",
    escalation_levels: int = 7,
    escalation_fold: float = 2.0,
    max_dose_mg: float | None = None,
    dlt_probabilities: list[float] | None = None,
    sad_cohort_size: int = DEFAULT_SAD_COHORT,
    mad_cohort_size: int = DEFAULT_MAD_COHORT,
    mad_frequency: str = "QD",
    collect_precedent: bool = True,
    indication: str | None = None,
    regulatory_region: str = "FDA",
    ind_declared_complete: dict[str, bool] | None = None,
    ind_override_justification: str | None = None,
    assess_benefit_risk_context: bool = True,
    # Measured disposition inputs (fu_plasma, clint_hep_ul_min_1e6, vdss_l_per_kg,
    # half_life_obach_h, blood_plasma_ratio) carried forward from the earlier
    # layers. A measured value outranks the ML prediction in `pk_ivive`, so the
    # human projection must see the same overrides the animal study ran on —
    # otherwise the two exposures come from different disposition and every
    # margin computed between them is meaningless.
    overrides: dict[str, Any] | None = None,
    seed: int = 42,
    engine: str = "kernel",
) -> dict[str, Any]:
    """Run the full first-in-human projection over a completed L3 study record."""
    if not study or not study.get("available"):
        return {
            "schema_version": SCHEMA_VERSION,
            "available": False,
            "source": "insufficient-input",
            "reason": (
                "The first-in-human layer requires a completed animal study. Run Layer 3 and "
                "pass its study record."
            ),
        }

    smiles = study.get("smiles")
    if not smiles:
        return {
            "schema_version": SCHEMA_VERSION,
            "available": False,
            "source": "insufficient-input",
            "reason": "The animal study record carries no molecular structure.",
        }

    study_summary = study.get("study_summary") or {}
    animal_species = str(study_summary.get("species") or "rat")
    potency = _potency_from_study(study)
    mw = _mw_from_study(study)
    ml_inputs = _ml_inputs_from_study(study)
    points_of_departure = study.get("points_of_departure") or {}

    # 1) Translate every animal point of departure to a human dose (FDA 2005).
    translation = translate_points_of_departure(
        points_of_departure, animal_species, risk_flags
    )

    # 2) Calibrate the human dose–exposure relationship with the same PBPK core.
    calibration = project_human_exposures(
        smiles,
        list(CALIBRATION_DOSES_MG),
        route=route,
        formulation=formulation,
        frequency=frequency,
        duration_h=duration_h,
        cohort_size=cohort_size,
        mw_g_per_mol=mw,
        body_weight_kg=body_weight_kg,
        ml_inputs=ml_inputs,
        overrides=overrides,
        seed=seed,
        engine=engine,
    )

    # 3) MABEL and the pharmacologically active dose from that calibration.
    mabel = compute_mabel(potency, calibration)
    pad = compute_pharmacologically_active_dose(potency, calibration)

    # 4) Reconcile the approaches — the lowest defensible dose governs.
    starting_dose = recommend_starting_dose(
        translations=translation, mabel=mabel, pad=pad
    )

    record: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "projection_id": str(uuid4()),
        "study_id": study.get("study_id"),
        "analysis_id": study.get("analysis_id"),
        "smiles": smiles,
        "source": "l4_first_in_human",
        "generated_at": datetime.now(UTC).isoformat(),
        "owner": "hakase_smallmol.l4.pipeline",
        "animal_species": animal_species,
        "route": route.upper(),
        "frequency": frequency,
        "reference_human_weight_kg": body_weight_kg,
        "translation": translation,
        "human_dose_exposure_calibration": calibration,
        "mabel": mabel,
        "pharmacologically_active_dose": pad,
        "starting_dose": starting_dose,
        "allometric_cross_check": _allometric_cross_check(study, animal_species),
        "indication": indication,
        "provenance": {"owner": "hakase_smallmol.l4.pipeline", "client_contract": "display-only"},
    }

    if not starting_dose.get("available"):
        record["available"] = False
        record["reason"] = starting_dose.get("reason")
        record["gate"] = first_in_human_gate(
            starting_dose=starting_dose,
            margins={"available": False, "reason": "No starting dose to build a ladder from."},
            human_exposures=calibration,
            l3_toxicology=study.get("toxicology") or {},
            precedent={"available": False, "reason": "Not attempted without a starting dose."},
        )
        # The sub-study and filing-readiness views still hold: both are driven by
        # the inherited L3 disposition and liability blocks, not by the ladder.
        record["sub_studies"] = assess_sub_studies(route=route, study=study)
        record["ind_gate"] = evaluate_ind_gate(
            record,
            region=regulatory_region,
            declared_complete=ind_declared_complete,
            override_justification=ind_override_justification,
        )
        record["benefit_risk"] = _benefit_risk_block(
            record,
            study=study,
            indication=indication,
            enabled=assess_benefit_risk_context,
        )
        record = assemble_report(record)
        put_projection(record["projection_id"], record)
        return record

    # 5) Escalation ladder from the recommended starting dose.
    ladder = build_ladder(
        float(starting_dose["recommended_starting_dose_total_mg"]),
        scheme=escalation_scheme,
        n_levels=escalation_levels,
        fold=escalation_fold,
        max_dose_mg=max_dose_mg,
    )

    # 6) Re-project human exposure on the actual clinical dose levels.
    human_exposures = project_human_exposures(
        smiles,
        [level["dose_total_mg"] for level in ladder.get("levels", [])],
        route=route,
        formulation=formulation,
        frequency=frequency,
        duration_h=duration_h,
        cohort_size=cohort_size,
        mw_g_per_mol=mw,
        body_weight_kg=body_weight_kg,
        ml_inputs=ml_inputs,
        overrides=overrides,
        seed=seed,
        engine=engine,
    )

    # 7) Exposure margins against the animal point-of-departure exposure.
    margins = compute_exposure_margins(
        human_exposures=human_exposures,
        animal_pod_exposure=points_of_departure.get("preferred_pod_exposure") or {},
        animal_pod=points_of_departure.get("preferred_pod"),
        animal_species=animal_species,
    )
    safety_margins = compute_safety_pharmacology_margins(
        human_exposures=human_exposures,
        animal_safety_pharmacology=study.get("safety_pharmacology") or {},
    )

    # 8) Trial design and stopping rules.
    trial_design = {
        "sad": design_sad(
            ladder=ladder, human_exposures=human_exposures, cohort_size=sad_cohort_size
        ),
        "mad": design_mad(
            ladder=ladder,
            human_exposures=human_exposures,
            cohort_size=mad_cohort_size,
            frequency=mad_frequency,
        ),
        "stopping_rules": stopping_rules(
            margins=margins, toxicology_summary=(study.get("toxicology") or {}).get("summary")
        ),
        "escalation_operating_characteristics": escalation_operating_characteristics(
            ladder, dlt_probabilities, seed=seed
        ),
    }

    # 9) Clinical precedent (best-effort; never blocks the projection).
    precedent: dict[str, Any] = {"available": False, "skipped": True}
    if collect_precedent:
        try:
            from hakase_smallmol.l4.evidence_engine import collect_clinical_precedent

            target = (study.get("resolved_inputs") or {}).get("target") or {}
            precedent = collect_clinical_precedent(
                gene_symbol=target.get("gene_symbol"),
                target_protein=target.get("target_protein"),
                therapeutic_area=(study.get("resolved_inputs") or {}).get("therapeutic_area"),
            )
        except Exception as exc:  # noqa: BLE001
            precedent = {"available": False, "error": str(exc)}

    gate = first_in_human_gate(
        starting_dose=starting_dose,
        margins=margins,
        human_exposures=human_exposures,
        l3_toxicology=study.get("toxicology") or {},
        precedent=precedent,
    )

    record.update(
        {
            "available": True,
            "escalation_ladder": ladder,
            "human_exposures": human_exposures,
            "exposure_margins": margins,
            "safety_pharmacology_margins": safety_margins,
            "trial_design": trial_design,
            "clinical_precedent": precedent,
            "gate": gate,
        }
    )

    # 10) Phase-1 sub-study feasibility, filing readiness, and the regulatory
    #     benefit-risk context. None of these can overturn the gate above; they
    #     sit beside it and answer the questions a protocol author asks next.
    record["sub_studies"] = assess_sub_studies(
        route=route, study=study, safety_pharmacology_margins=safety_margins
    )
    record["ind_gate"] = evaluate_ind_gate(
        record,
        region=regulatory_region,
        declared_complete=ind_declared_complete,
        override_justification=ind_override_justification,
    )
    record["benefit_risk"] = _benefit_risk_block(
        record,
        study=study,
        indication=indication,
        enabled=assess_benefit_risk_context,
    )

    record = assemble_report(record)
    put_projection(record["projection_id"], record)
    return record


def _benefit_risk_block(
    record: dict[str, Any],
    *,
    study: dict[str, Any],
    indication: str | None,
    enabled: bool,
) -> dict[str, Any]:
    """Regulatory benefit-risk context, never a substitute for the safety gate."""
    if not enabled:
        return {
            "available": False,
            "reason": "The benefit-risk assessment was disabled for this run.",
        }
    if not (indication or (study.get("resolved_inputs") or {}).get("therapeutic_area")):
        return {
            "available": False,
            "reason": (
                "Benefit-risk needs an indication. The FDA framework weighs risk against the "
                "severity of a specific condition, so it is not assessable without one — and "
                "guessing the indication from the structure would fabricate the very input the "
                "assessment turns on."
            ),
            "remediation": "Supply an indication with the projection request.",
        }
    try:
        return assess_benefit_risk(
            indication=indication,
            therapeutic_area=(study.get("resolved_inputs") or {}).get("therapeutic_area"),
            gate=record.get("gate") or {},
            toxicology_summary=(study.get("toxicology") or {}).get("summary") or {},
            starting_dose=record.get("starting_dose") or {},
            pharmacologically_active_dose=record.get("pharmacologically_active_dose") or {},
            margins=record.get("exposure_margins") or {},
            clinical_precedent=record.get("clinical_precedent") or {},
        )
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "reason": f"{type(exc).__name__}: {exc}"}


def _allometric_cross_check(study: dict[str, Any], animal_species: str) -> dict[str, Any]:
    """Scale the animal clearance to human as a sanity check on the PBPK run."""
    for arm in study.get("arms", []) or []:
        if not arm.get("available"):
            continue
        ep = ((arm.get("cohort") or {}).get("endpoints") or {}).get("plasma") or {}
        cl = (ep.get("cl") or {}).get("median")
        bw = ((arm.get("ivive") or {}).get("body_weight_kg")) or None
        if isinstance(cl, (int, float)) and isinstance(bw, (int, float)) and bw > 0:
            return allometric_exposure_scaling(float(cl) / float(bw), animal_species)
    return {
        "available": False,
        "reason": "No animal clearance with a body weight was available to scale.",
    }


__all__ = ["CALIBRATION_DOSES_MG", "run_first_in_human"]
