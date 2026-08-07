"""L3 orchestrator — run a complete virtual preclinical study.

Ingest → validate/resolve → design → simulate each dose group → PK/PD →
evidence → safety → sensitivity → stage gate → report → persist. Every engine
is a real computation; nothing is fabricated. The orchestrator only sequences
them and threads their outputs into one provenance-stamped study record.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from hakase_smallmol.l3 import SCHEMA_VERSION
from hakase_smallmol.l3.biodistribution_engine import biodistribution_summary
from hakase_smallmol.l3.ddi_engine import compute_ddi
from hakase_smallmol.l3.decision_engine import stage_gate
from hakase_smallmol.l3.model_panel import collect_panel
from hakase_smallmol.l3.organ_risk_engine import compute_organ_risk
from hakase_smallmol.l3.pbpk_adapter import AnimalSpec, parse_frequency_h, run_arm_exposure
from hakase_smallmol.l3.pkpd_engine import pkpd_summary
from hakase_smallmol.l3.pod_engine import compute_points_of_departure
from hakase_smallmol.l3.reporting_engine import assemble_report
from hakase_smallmol.l3.safety_engine import compute_safety
from hakase_smallmol.l3.safety_pharmacology_engine import compute_safety_pharmacology
from hakase_smallmol.l3.sensitivity_engine import compute_sensitivity
from hakase_smallmol.l3.store import put_study
from hakase_smallmol.l3.study_engine import StudyDesignError, build_arms
from hakase_smallmol.l3.study_outcomes_engine import compute_study_outcomes
from hakase_smallmol.l3.tk_engine import compute_toxicokinetics
from hakase_smallmol.l3.toxicology_engine import compute_toxicology_panel


def run_animal_study(
    *,
    analysis_id: str | None = None,
    smiles: str | None = None,
    animal: dict[str, Any],
    dose_groups: list[dict[str, Any]],
    route: str,
    formulation: str,
    cohort_size: int,
    frequency: str | None = None,
    duration_h: float = 24.0,
    infusion_duration_h: float | None = None,
    seed: int = 42,
    overrides: dict[str, Any] | None = None,
    collect_public_evidence: bool = True,
    engine: str = "auto",
    enforce_gate: bool = True,
) -> dict[str, Any]:
    """Run the full L3 study and return (and persist) the study record.

    Either ``analysis_id`` (normal path — reuses the L1 disposition/potency) or
    ``smiles`` (bare structure) must be supplied.

    When ``enforce_gate`` is set (the default) and the run is anchored on a real
    ``analysis_id``, the L2→L3 stage gate must be clear: no hard blocks, and every
    soft warning acknowledged under a recorded reviewer signature. The signature
    is copied onto the study record so the audit trail travels with the result.
    """
    from hakase_smallmol.l3.parameter_engine import resolve_from_analysis, resolve_from_smiles

    if analysis_id:
        resolved = resolve_from_analysis(analysis_id)
    elif smiles and smiles.strip():
        resolved = resolve_from_smiles(smiles)
    else:
        raise ValueError("Provide an analysis_id or a SMILES to run an animal study.")

    if not resolved.smiles:
        return {
            "schema_version": SCHEMA_VERSION,
            "available": False,
            "source": "insufficient-input",
            "reason": "No molecular structure resolved from the supplied analysis/SMILES.",
        }

    # 0) Stage gate. A study anchored on an L1 analysis may not run until the
    #    accumulated evidence has been reviewed and signed.
    gate_snapshot: dict[str, Any] | None = None
    if enforce_gate and resolved.analysis_id:
        from hakase_smallmol.l3.gate_engine import evaluate_gate

        gate_snapshot = evaluate_gate(resolved, species=str(animal.get("species") or "rat"))
        if not gate_snapshot["clear_to_proceed"]:
            if gate_snapshot["blocks"]:
                reason = "The stage gate carries unresolved hard blocks."
            elif gate_snapshot["outstanding_warning_codes"]:
                reason = "Stage-gate warnings have not all been acknowledged."
            else:
                reason = "The stage gate has not been signed by a named reviewer."
            return {
                "schema_version": SCHEMA_VERSION,
                "available": False,
                "source": "stage-gate",
                "reason": reason,
                "gate": gate_snapshot,
            }

    animal_spec = AnimalSpec(
        species=animal["species"],
        strain=animal.get("strain"),
        sex=animal.get("sex"),
        age=animal.get("age"),
        body_weight_kg=animal.get("body_weight") or animal.get("body_weight_kg"),
    )

    # 1) Study design → arms (validated against physiology catalog + routes).
    try:
        arms, design_warnings = build_arms(
            animal=animal_spec,
            dose_groups=dose_groups,
            route=route,
            frequency=frequency,
            duration_h=duration_h,
            infusion_duration_h=infusion_duration_h,
        )
    except StudyDesignError as exc:
        return {
            "schema_version": SCHEMA_VERSION,
            "available": False,
            "source": "input-error",
            "reason": str(exc),
        }

    # Resolve the simulation engine: "auto" prefers mrgsolve (Metrum) when R is
    # available, else the in-house kernel PBPK. Explicit "kernel"/"mrgsolve" honor
    # the request (mrgsolve falls back to kernel if unavailable, flagged per arm).
    from hakase_smallmol.l3.mrgsolve_adapter import mrgsolve_available

    requested_engine = (engine or "auto").lower()
    if requested_engine == "auto":
        resolved_engine = "mrgsolve" if mrgsolve_available() else "kernel"
    else:
        resolved_engine = requested_engine

    # 2) Simulate each dose group through the validated exposure core.
    arm_results: list[dict[str, Any]] = []
    for arm in arms:
        arm_results.append(
            run_arm_exposure(
                resolved.smiles,
                animal=animal_spec,
                arm=arm,
                formulation=formulation,
                cohort_size=cohort_size,
                ml_inputs=resolved.ml_inputs or None,
                overrides=overrides,
                seed=seed,
                engine=resolved_engine,
            )
        )

    # 3) PK metrics, dose-proportionality, target coverage, exposure–response.
    pkpd = pkpd_summary(arm_results, resolved.potency)

    # 3a) The outcome panel: one shared predictor bundle, then every study-level
    #     readout a preclinical package reports. Each engine is independent and
    #     degrades to an explicit "not predicted" rather than failing the run.
    panel = collect_panel(resolved.smiles, resolved.analysis, allow_live=True)
    tau_h = None
    try:
        tau_h = parse_frequency_h(frequency)
    except ValueError:
        tau_h = None
    biodistribution = biodistribution_summary(
        arm_results, tau_h=tau_h, bbb_probability=panel.probability("BBB_Martins")
    )
    toxicokinetics = compute_toxicokinetics(
        arm_results, frequency=frequency, duration_h=duration_h
    )
    toxicology = compute_toxicology_panel(
        panel=panel, arm_results=arm_results, biodistribution=biodistribution
    )
    safety_pharmacology = compute_safety_pharmacology(
        panel=panel, arm_results=arm_results, biodistribution=biodistribution
    )
    ddi = compute_ddi(panel=panel, arm_results=arm_results)

    # 3b) Target-organ rollup — the hazard panel joined onto the tissue exposure,
    #     which is what the body map renders. A join, not a new prediction.
    organ_risk = compute_organ_risk(
        toxicology=toxicology,
        biodistribution=biodistribution,
        safety_pharmacology=safety_pharmacology,
    )

    # 4) Public animal evidence (best-effort; safety anchors depend on it).
    evidence: dict[str, Any] = {"available": False, "skipped": True}
    if collect_public_evidence:
        try:
            from hakase_smallmol.l3.evidence_engine import collect_evidence

            evidence = collect_evidence(resolved.smiles)
        except Exception as exc:  # noqa: BLE001
            evidence = {"available": False, "error": str(exc)}

    # 5) Safety margins (three labelled anchors + hazard flags).
    safety = compute_safety(
        resolved_safety_flags=resolved.safety_flags,
        arm_results=arm_results,
        evidence=evidence,
        study_species=animal_spec.species,
    )

    # 5a) Points of departure + reverse dosimetry (the handoff the L4 first-in-
    #     human layer consumes to project a human starting dose).
    points_of_departure = compute_points_of_departure(
        panel=panel,
        arm_results=arm_results,
        safety=safety,
        potency=resolved.potency,
        toxicology=toxicology,
    )

    # 5b) Study-report rollup: mechanism → procedure, plus design conformance.
    has_control = any(
        float(g.get("dose_mg_per_kg", 0) or 0) <= 0 for g in (dose_groups or [])
    )

    # 6) Sensitivity (drivers of the exposure prediction) — on the first valid arm.
    first_valid = next((a for a in arm_results if a.get("available")), None)
    sensitivity = (
        compute_sensitivity(first_valid)
        if first_valid
        else {"available": False, "reason": "No valid arm to analyse."}
    )

    # 7) Stage-gate recommendation.
    gate = stage_gate(
        arm_results=arm_results,
        pkpd=pkpd,
        safety=safety,
        evidence=evidence,
        sensitivity=sensitivity,
    )

    study_id = str(uuid4())
    active_doses = [round(a.dose_mg_per_kg, 4) for a in arms]
    n_ok = sum(1 for a in arm_results if a.get("available"))
    engines_used = sorted({a.get("engine_used") for a in arm_results if a.get("engine_used")})

    # Engine fidelity. A per-arm mrgsolve fallback is recorded inside that arm's
    # envelope, which a reader of the aggregated study will never open. When the
    # requested engine did not run for every arm the study says so at the top
    # level, because "cross-checked against mrgsolve" and "the R engine was
    # missing so the kernel ran instead" are different claims.
    fallback_arms = [
        {
            "arm": arm.get("arm_label") or arm.get("label") or index,
            "engine_used": arm.get("engine_used"),
            "warnings": [
                warning
                for warning in (arm.get("warnings") or [])
                if "mrgsolve" in str(warning).lower()
            ],
        }
        for index, arm in enumerate(arm_results)
        if arm.get("engine_used") and arm.get("engine_used") != requested_engine
    ]
    engine_fidelity = {
        "requested": requested_engine,
        "used": engines_used,
        "all_arms_used_requested_engine": not fallback_arms,
        "fallback_arms": fallback_arms,
        "notice": (
            None
            if not fallback_arms
            else (
                f"{len(fallback_arms)} of {len(arm_results)} arm(s) did not run on the "
                f"requested '{requested_engine}' engine and fell back to the in-house "
                "kernel PBPK. The independent cross-check was therefore not performed "
                "for those arms."
            )
        ),
    }
    record: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "study_id": study_id,
        "analysis_id": resolved.analysis_id,
        "smiles": resolved.smiles,
        "available": n_ok > 0,
        "source": "l3_animal_study",
        "generated_at": datetime.now(UTC).isoformat(),
        "owner": "hakase_smallmol.l3.pipeline",
        "study_summary": {
            "species": animal_spec.species,
            "strain": arm_results[0].get("strain") if arm_results else animal_spec.strain,
            "sex": animal_spec.sex,
            "route": route.upper(),
            "frequency": frequency,
            "duration_h": duration_h,
            "dose_groups_mg_kg": active_doses,
            "cohort_size": cohort_size,
            "arms_simulated": len(arms),
            "arms_available": n_ok,
            "engine_requested": requested_engine,
            "engine_used": engines_used[0] if len(engines_used) == 1 else (engines_used or None),
            "simulation_engine": (
                "mrgsolve (Metrum) — R/C++ ODE PBPK"
                if engines_used == ["mrgsolve"]
                else "Hakase kernel PBPK (scipy)"
            ),
            "engine_fidelity": engine_fidelity,
        },
        "engine_fidelity": engine_fidelity,
        # A silent per-arm fallback is promoted to a study-level readiness
        # warning so it appears wherever readiness warnings are rendered.
        "readiness_warnings": (
            [*design_warnings, engine_fidelity["notice"]]
            if engine_fidelity["notice"]
            else design_warnings
        ),
        "gate": gate_snapshot,
        "signoff": (gate_snapshot or {}).get("signoff"),
        "resolved_inputs": resolved.to_dict(),
        "arms": arm_results,
        "pkpd": pkpd,
        "biodistribution": biodistribution,
        "toxicokinetics": toxicokinetics,
        "toxicology": toxicology,
        "safety_pharmacology": safety_pharmacology,
        "organ_risk": organ_risk,
        "ddi": ddi,
        "points_of_departure": points_of_departure,
        "model_panel": panel.to_dict(),
        "evidence": evidence,
        "safety": safety,
        "sensitivity": sensitivity,
        "stage_gate": gate,
        "provenance": {"owner": "hakase_smallmol.l3.pipeline", "client_contract": "display-only"},
    }

    record["study_outcomes"] = compute_study_outcomes(
        toxicology=toxicology,
        study_summary=record["study_summary"],
        has_control=has_control,
    )

    record = assemble_report(record)
    put_study(study_id, record)
    return record


__all__ = ["run_animal_study"]
