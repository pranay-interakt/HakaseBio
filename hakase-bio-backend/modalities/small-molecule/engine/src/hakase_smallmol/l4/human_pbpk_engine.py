"""Human exposure projection — the same validated PBPK core, human physiology.

The animal layer simulates a virtual cohort of rats or dogs. Nothing about that
machinery is species-specific: the kernel physiology store carries a reference
human, and the IVIVE handoff accepts ``species="human"``. So the first-in-human
projection is not a new model — it is the *same* engine run with human
parameters, which is exactly what makes the animal-to-human comparison
meaningful.

This module runs a virtual human cohort at each planned clinical dose and
returns the exposure metrics a Phase 1 protocol needs: Cmax, Tmax, AUC, half
life, accumulation on repeat dosing, and the free concentrations that safety
margins are computed against.

The clinical dose is specified in **total mg** (how a protocol is written) and
converted to mg/kg against the FDA reference 60 kg adult before simulation.
"""

from __future__ import annotations

from typing import Any

from hakase_smallmol.l3.pbpk_adapter import AnimalSpec, ArmSpec, run_arm_exposure
from hakase_smallmol.l4.translation_engine import REFERENCE_HUMAN_WEIGHT_KG


def simulate_human_dose(
    smiles: str,
    *,
    dose_total_mg: float,
    route: str,
    formulation: str,
    frequency: str | None,
    duration_h: float,
    cohort_size: int,
    body_weight_kg: float = REFERENCE_HUMAN_WEIGHT_KG,
    ml_inputs: dict[str, float] | None = None,
    overrides: dict[str, Any] | None = None,
    seed: int = 42,
    label: str | None = None,
    engine: str = "kernel",
) -> dict[str, Any]:
    """Run one human dose level through the validated PBPK cohort engine."""
    if not (dose_total_mg and dose_total_mg > 0):
        return {"available": False, "reason": "A positive total dose in mg is required."}
    dose_mg_per_kg = float(dose_total_mg) / float(body_weight_kg)
    arm = ArmSpec(
        label=label or f"{dose_total_mg:g} mg",
        dose_mg_per_kg=dose_mg_per_kg,
        route=route.upper(),
        frequency=frequency,
        duration_h=duration_h,
    )
    result = run_arm_exposure(
        smiles,
        animal=AnimalSpec(species="human", body_weight_kg=body_weight_kg),
        arm=arm,
        formulation=formulation,
        cohort_size=cohort_size,
        ml_inputs=ml_inputs,
        overrides=overrides,
        seed=seed,
        engine=engine,
    )
    result["dose_total_mg"] = float(dose_total_mg)
    result["dose_mg_per_kg"] = round(dose_mg_per_kg, 6)
    result["reference_body_weight_kg"] = body_weight_kg
    return result


def _plasma(arm_result: dict[str, Any], key: str) -> dict[str, Any]:
    ep = ((arm_result.get("cohort") or {}).get("endpoints") or {}).get("plasma") or {}
    block = ep.get(key) or {}
    return block if isinstance(block, dict) else {}


def human_exposure_row(arm_result: dict[str, Any], mw_g_per_mol: float | None) -> dict[str, Any]:
    """One row of the human exposure table, in both mass and molar units."""
    if not arm_result.get("available"):
        return {
            "available": False,
            "dose_total_mg": arm_result.get("dose_total_mg"),
            "reason": arm_result.get("reason"),
            "missing": arm_result.get("missing"),
        }
    c_max = _plasma(arm_result, "c_max").get("median")
    auc = _plasma(arm_result, "auc").get("median")
    t_half = _plasma(arm_result, "t_half").get("median")
    fu = (((arm_result.get("ivive") or {}).get("inputs") or {}).get("fu_plasma") or {}).get("value")
    row: dict[str, Any] = {
        "available": True,
        "label": (arm_result.get("arm") or {}).get("label"),
        "dose_total_mg": arm_result.get("dose_total_mg"),
        "dose_mg_per_kg": arm_result.get("dose_mg_per_kg"),
        "cmax_mg_per_l": round(c_max, 6) if isinstance(c_max, (int, float)) else None,
        "cmax_interval": [
            _plasma(arm_result, "c_max").get("p05"),
            _plasma(arm_result, "c_max").get("p95"),
        ],
        "tmax_h": _plasma(arm_result, "t_max").get("median"),
        "auc_mg_h_per_l": round(auc, 6) if isinstance(auc, (int, float)) else None,
        "auc_interval": [
            _plasma(arm_result, "auc").get("p05"),
            _plasma(arm_result, "auc").get("p95"),
        ],
        "t_half_h": round(t_half, 3) if isinstance(t_half, (int, float)) else None,
        "cl_l_per_h": _plasma(arm_result, "cl").get("median"),
        "vss_l_per_kg": _plasma(arm_result, "vss").get("median"),
        "fu_plasma": fu,
    }
    if mw_g_per_mol and mw_g_per_mol > 0 and isinstance(c_max, (int, float)):
        to_uM = 1000.0 / mw_g_per_mol
        row["cmax_uM"] = round(float(c_max) * to_uM, 6)
        if isinstance(fu, (int, float)):
            row["free_cmax_uM"] = round(float(c_max) * float(fu) * to_uM, 7)
        if isinstance(auc, (int, float)):
            row["auc_uM_h"] = round(float(auc) * to_uM, 6)
            if isinstance(fu, (int, float)):
                row["free_auc_uM_h"] = round(float(auc) * float(fu) * to_uM, 7)
    return row


def project_human_exposures(
    smiles: str,
    dose_levels_mg: list[float],
    *,
    route: str,
    formulation: str,
    frequency: str | None,
    duration_h: float,
    cohort_size: int,
    mw_g_per_mol: float | None,
    body_weight_kg: float = REFERENCE_HUMAN_WEIGHT_KG,
    ml_inputs: dict[str, float] | None = None,
    overrides: dict[str, Any] | None = None,
    seed: int = 42,
    engine: str = "kernel",
) -> dict[str, Any]:
    """Simulate a virtual human cohort at every planned dose level."""
    if not dose_levels_mg:
        return {"available": False, "reason": "No dose levels were supplied to simulate."}
    arms: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    for dose in dose_levels_mg:
        result = simulate_human_dose(
            smiles,
            dose_total_mg=float(dose),
            route=route,
            formulation=formulation,
            frequency=frequency,
            duration_h=duration_h,
            cohort_size=cohort_size,
            body_weight_kg=body_weight_kg,
            ml_inputs=ml_inputs,
            overrides=overrides,
            seed=seed,
            engine=engine,
        )
        arms.append(result)
        rows.append(human_exposure_row(result, mw_g_per_mol))

    usable = [r for r in rows if r.get("available")]
    return {
        "available": bool(usable),
        "reason": None if usable else (rows[0].get("reason") if rows else "No dose simulated."),
        "reference_body_weight_kg": body_weight_kg,
        "schedule": {"route": route.upper(), "frequency": frequency, "duration_h": duration_h},
        "cohort_size": cohort_size,
        "dose_levels_mg": list(dose_levels_mg),
        "exposures": rows,
        "arms": arms,
        "units": {
            "cmax": "mg/L (and µM where molecular weight is known)",
            "auc": "mg·h/L over the simulated window",
            "t_half": "h",
        },
        "model": (
            "Hakase kernel PBPK (13-compartment perfusion-limited ODE) with the reference human "
            "physiology and a human IVIVE disposition, run as a virtual cohort"
        ),
        "provenance": "derived",
        "limitations": (
            "Human clearance is projected by IVIVE from in-vitro intrinsic clearance and an "
            "ML-predicted unbound fraction; it is not observed human PK. The cohort captures "
            "physiological variability, not pharmacogenomic variability (CYP2D6/2C19 phenotype, "
            "transporter polymorphisms), disease state, or food effect."
        ),
    }


__all__ = ["human_exposure_row", "project_human_exposures", "simulate_human_dose"]
