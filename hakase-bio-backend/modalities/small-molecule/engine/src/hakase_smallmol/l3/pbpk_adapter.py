"""Reusable single-arm PBPK exposure core (the L3 population engine's workhorse).

This is the exact IVIVE → Kp → disposition → virtual-cohort pipeline that the
Phase-0 ``/predict/pbpk/exposure`` endpoint runs, factored into one callable so
L3 can invoke it once per **dose group** with identical, validated science.

It calls only real engines:
  • ``predict_pk_ivive``          — disposition source of truth (L1/L2 handoff)
  • ``compute_kp``                — Rodgers & Rowland tissue partitioning
  • ``assemble_disposition``      — the kernel ``DispositionParameters`` contract
  • ``compute_formulation_impact``— BCS-driven absorbed fraction for oral/SC
  • ``run_virtual_cohort``        — N-animal Monte-Carlo over the kernel ODE

No number is invented. When a required real input is absent the arm returns an
``available=False`` envelope with a ``missing`` list — never a guessed value.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

# Dosing-interval tau (hours) for the supported frequency tokens.
_FREQUENCY_TAU_H: dict[str, float] = {
    "QD": 24.0,
    "BID": 12.0,
    "TID": 8.0,
    "QID": 6.0,
    "Q24H": 24.0,
    "Q12H": 12.0,
    "Q8H": 8.0,
    "Q6H": 6.0,
    "Q4H": 4.0,
}


def parse_frequency_h(frequency: str | None) -> float | None:
    """Dosing interval tau in hours for a frequency token.

    ``None`` / ``SINGLE`` → single dose (no repeat). Accepts QD/BID/TID/QID and
    ``QNH`` forms (e.g. Q12H). Unknown tokens raise ``ValueError``.
    """
    if not frequency:
        return None
    tok = frequency.strip().upper()
    if tok in {"", "SINGLE"}:
        return None
    if tok in _FREQUENCY_TAU_H:
        return _FREQUENCY_TAU_H[tok]
    if tok.startswith("Q") and tok.endswith("H"):
        try:
            return float(tok[1:-1])
        except ValueError:
            pass
    raise ValueError(f"Unsupported dosing frequency {frequency!r}.")


@dataclass(frozen=True)
class ArmSpec:
    """One dose group to simulate."""

    label: str  # e.g. "Low", "Mid", "High"
    dose_mg_per_kg: float
    route: str  # "IV" | "ORAL" | "SC"
    frequency: str | None = None  # e.g. "QD", "BID", or None for single dose
    duration_h: float = 24.0
    infusion_duration_h: float | None = None
    is_control: bool = False


@dataclass(frozen=True)
class AnimalSpec:
    species: str
    strain: str | None = None
    sex: str | None = None
    age: str | None = None
    body_weight_kg: float | None = None


# First-order oral/SC absorption rate constant (reference; overridable when a
# measured ka exists). ~1/h is a physiological default. The kernel ODE runs in
# MINUTES, so its ka is per-minute (KA_PER_H/60); the mrgsolve engine runs in
# HOURS and uses KA_PER_H directly. Both are fed the SAME KA_PER_H.
KA_PER_H = 1.0


def _forcing_factory(arm: ArmSpec, f_abs: float):
    """Build the kernel dosing forcing-model factory (kernel time unit = MINUTES).

    The absolute dose is scaled per sampled animal body weight inside the factory.
    Frequency/duration are converted hours→minutes to match the kernel ODE.
    """
    from hakase_kernel.pbpk.absorption import (
        IVBolus,
        IVInfusion,
        Oral,
        RepeatDose,
        SCDepot,
    )

    route = arm.route.upper()
    ka_min = KA_PER_H / 60.0
    tau_h = parse_frequency_h(arm.frequency)
    tau_min = tau_h * 60.0 if tau_h else None
    infusion_min = (
        arm.infusion_duration_h * 60.0
        if arm.infusion_duration_h and arm.infusion_duration_h > 0
        else None
    )

    def factory(phys):
        d = arm.dose_mg_per_kg * phys.body_weight_kg
        if tau_min:
            if route == "ORAL":
                return RepeatDose(d, ka_min, f_abs, tau_min, "gut")
            if route == "SC":
                return RepeatDose(d, ka_min, f_abs, tau_min, "venous_blood")
            # Repeat IV approximated as a fast first-order input; flagged in metadata.
            return RepeatDose(d, 10.0 / 60.0, 1.0, tau_min, "venous_blood")
        if route == "IV":
            if infusion_min:
                return IVInfusion(d, infusion_min)
            return IVBolus(d)
        if route == "SC":
            return SCDepot(d, ka=ka_min, f_abs=f_abs)
        if route == "ORAL":
            return Oral(d, ka=ka_min, f_abs=f_abs)
        return IVBolus(d)

    return factory


# Time-based endpoint fields to convert when rescaling the kernel cohort minutes→hours.
_TIME_SCALE = {"t_max": 1 / 60.0, "auc": 1 / 60.0, "t_half": 1 / 60.0, "cl": 60.0}


def _cohort_minutes_to_hours(cohort: dict[str, Any]) -> dict[str, Any]:
    """Rescale a kernel cohort (integrated in minutes) to HOURS at the boundary.

    Concentrations (mg/L) and Vss (L/kg) are time-independent and unchanged. The
    time axis (min→h), Tmax (min→h), AUC (mg·min/L→mg·h/L), t½ (min→h) and CL
    (L/min→L/h) are converted so every engine reports hours-based metrics.
    """
    cohort["time"] = [t / 60.0 for t in cohort.get("time", [])]
    # The kernel aliases endpoints["plasma"] to the SAME dict as
    # endpoints["venous_blood"] (and curves likewise). Deduplicate by object
    # identity so a shared endpoint dict is scaled exactly once, never twice.
    seen: set[int] = set()
    for eps in (cohort.get("endpoints") or {}).values():
        if id(eps) in seen:
            continue
        seen.add(id(eps))
        for field, factor in _TIME_SCALE.items():
            block = eps.get(field)
            if isinstance(block, dict):
                for k in ("median", "p05", "p95"):
                    if isinstance(block.get(k), (int, float)):
                        block[k] = block[k] * factor
    return cohort


def _n_doses(arm: ArmSpec) -> int:
    tau_h = parse_frequency_h(arm.frequency)
    if not tau_h:
        return 1
    return max(1, int((arm.duration_h or 24.0) / tau_h))


def _insufficient(reason: str, missing: list[str], **extra: Any) -> dict[str, Any]:
    return {
        "available": False,
        "source": "insufficient-input",
        "reason": reason,
        "missing": missing,
        **extra,
    }


def run_arm_exposure(
    smiles: str,
    *,
    animal: AnimalSpec,
    arm: ArmSpec,
    formulation: str,
    cohort_size: int,
    ml_inputs: dict[str, float] | None = None,
    overrides: dict[str, Any] | None = None,
    seed: int = 42,
    n_time: int = 100,
    engine: str = "kernel",
) -> dict[str, Any]:
    """Run one dose-group arm end to end. Returns a structured envelope.

    On success: ``{available: True, arm, ivive, disposition, formulation,
    cohort, ...}`` where ``cohort`` is the kernel ``run_virtual_cohort`` output
    (per-organ mean/p05/p95 curves + Cmax/Tmax/AUC/CL/Vss/t½ medians+intervals).
    On failure: an ``available=False`` envelope (no fabricated numbers).
    """
    from hakase_kernel.pbpk.absorption import compute_formulation_impact
    from hakase_kernel.pbpk.cohort import run_virtual_cohort
    from hakase_kernel.pbpk.contract import ApplicabilityDomain
    from hakase_kernel.pbpk.model import clearance_law, transport_law
    from hakase_kernel.pbpk.physiology.store import get_physiology
    from hakase_kernel.uncertainty.applicability_domain import predict_applicability_domain
    from rdkit import Chem
    from rdkit.Chem import Descriptors, rdMolDescriptors

    from hakase_smallmol.pk_ivive.disposition import assemble_disposition
    from hakase_smallmol.pk_ivive.kp import compute_kp
    from hakase_smallmol.pk_ivive.logp_resolver import fetch_logd_7_4, resolve_neutral_logp
    from hakase_smallmol.pk_ivive.pk_ivive import predict_pk_ivive
    from hakase_smallmol.pk_ivive.pka import predict_pka

    if not smiles or not smiles.strip():
        return _insufficient("A molecular structure is required.", ["smiles"])

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return {
            "available": False,
            "source": "input-error",
            "reason": "The molecular structure could not be parsed.",
        }

    # 1) Applicability-domain gate (hard refusal outside the trained domain).
    try:
        ad_result = predict_applicability_domain(smiles)
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "source": "input-error", "reason": str(exc)}
    if ad_result.get("ad_label") not in {"In-domain", "Border-domain"}:
        return _insufficient(
            "Applicability coverage is insufficient for a pharmacokinetic projection.",
            ["applicability_domain"],
            applicability_domain=ad_result,
            remediation=(
                "Use a closer chemical analogue or provide measured disposition inputs "
                "before projecting animal exposure."
            ),
        )

    # 2) IVIVE disposition (with Monte-Carlo intervals) for this species.
    ivive_res = predict_pk_ivive(
        smiles,
        overrides=overrides,
        ml_inputs=ml_inputs,
        species=animal.species,
        strain=animal.strain,
        body_weight_kg=animal.body_weight_kg,
        montecarlo=True,
    )
    if ivive_res.get("source") == "insufficient-input":
        return {**ivive_res, "available": False}
    if ivive_res.get("source") != "ivive":
        return {"available": False, "source": "input-error", "reason": ivive_res.get("reason")}

    fu_plasma = (ivive_res.get("inputs", {}).get("fu_plasma") or {}).get("value")
    bpr = (ivive_res.get("system_parameters", {}).get("blood_plasma_ratio") or {}).get("value")
    if fu_plasma is None:
        return _insufficient("Unbound plasma fraction was not returned.", ["fu_plasma"])
    if bpr is None:
        return _insufficient("Blood-to-plasma ratio was not returned.", ["blood_plasma_ratio"])

    # 3) Tissue partition coefficients (Rodgers & Rowland).
    try:
        pka_res = predict_pka(smiles, allow_heuristic=True)
        crippen_logp = Descriptors.MolLogP(mol)
        logp = resolve_neutral_logp(crippen_logp, pka_res, fetch_logd_7_4(smiles)).logp
        kp_res = compute_kp(logp, pka_res, fu_plasma=fu_plasma, blood_plasma_ratio=bpr)
    except Exception as exc:  # noqa: BLE001
        return {
            "available": False,
            "source": "input-error",
            "reason": f"Kp prediction failed: {exc}",
        }

    # 4) Disposition contract (the kernel plug interface).
    ad = ApplicabilityDomain(
        verdict="in" if ad_result["ad_label"] == "In-domain" else "edge",
        score=ad_result.get("ad_score"),
        rationale=ad_result.get("coverage_note"),
    )
    try:
        disp = assemble_disposition(ivive_res, kp_res, applicability_domain=ad)
    except ValueError as exc:
        return _insufficient(str(exc), ["disposition"])
    if disp.applicability_domain.verdict == "out":
        return _insufficient(
            disp.applicability_domain.rationale
            or "Compound is outside the metabolic-clearance applicability domain.",
            ["metabolic_clearance_domain"],
            applicability_domain=disp.applicability_domain.to_dict(),
        )

    # 5) BCS-driven absorbed fraction for oral/SC (IV = 1.0 by construction).
    mw = Descriptors.MolWt(mol)
    tpsa = Descriptors.TPSA(mol)
    logp_form = Descriptors.MolLogP(mol)
    hbd = rdMolDescriptors.CalcNumHBD(mol)
    num_ar = rdMolDescriptors.CalcNumAromaticRings(mol)
    rot_bonds = rdMolDescriptors.CalcNumRotatableBonds(mol)
    form_res = compute_formulation_impact(
        logp_form, tpsa, mw, hbd, num_ar, rot_bonds, baseF=0.5, formulation_type=formulation
    )
    f_abs = form_res["F_abs_formulated"] if arm.route.upper() != "IV" else 1.0

    # 6) Virtual-cohort Monte-Carlo. Time axis is HOURS at the boundary; the
    #    kernel ODE integrates in MINUTES internally (converted back to hours).
    phys_base = get_physiology(animal.species, animal.strain)
    duration = arm.duration_h or 24.0
    time_h = list(np.linspace(0.0, duration, n_time))
    warnings: list[str] = list(ivive_res.get("system_warnings") or [])

    requested_engine = (engine or "kernel").lower()
    engine_used = "kernel"
    cohort: dict[str, Any]

    if requested_engine == "mrgsolve":
        from hakase_smallmol.l3.mrgsolve_adapter import (
            MrgsolveError,
            mrgsolve_available,
            run_cohort_mrgsolve,
        )

        if not mrgsolve_available():
            warnings.append(
                "mrgsolve engine requested but R/mrgsolve is unavailable; used the in-house kernel PBPK."
            )
        else:
            try:
                cohort = run_cohort_mrgsolve(
                    disp=disp,
                    phys_base=phys_base,
                    arm=arm,
                    f_abs=f_abs,
                    cohort_size=cohort_size,
                    seed=seed,
                    time_h=time_h,
                    ka_per_h=KA_PER_H,
                    tau_h=parse_frequency_h(arm.frequency),
                    n_doses=_n_doses(arm),
                )
                engine_used = "mrgsolve"
            except MrgsolveError as exc:
                warnings.append(
                    f"mrgsolve run failed ({exc}); fell back to the in-house kernel PBPK."
                )

    if engine_used == "kernel":
        t_min = np.asarray(time_h) * 60.0
        factory = _forcing_factory(arm, f_abs)
        try:
            cohort = run_virtual_cohort(
                disp_base=disp,
                n_animals=cohort_size,
                time_eval=t_min,
                forcing_model_factory=factory,
                phys_base=phys_base,
                transport_law=transport_law,
                clearance_law=clearance_law,
                seed=seed,
            )
        except Exception as exc:  # noqa: BLE001
            return {
                "available": False,
                "source": "input-error",
                "reason": f"Cohort simulation failed: {exc}",
            }
        cohort = _cohort_minutes_to_hours(cohort)

    if arm.route.upper() == "IV" and arm.frequency:
        warnings.append(
            "Repeat intravenous dosing approximated as a fast first-order input; "
            "interpret repeat-IV accumulation qualitatively."
        )

    return {
        "available": True,
        "source": "pbpk_exposure",
        "arm": {
            "label": arm.label,
            "dose_mg_per_kg": arm.dose_mg_per_kg,
            "route": arm.route.upper(),
            "frequency": arm.frequency,
            "duration_h": duration,
            "is_control": arm.is_control,
        },
        "species": ivive_res.get("species"),
        "strain": ivive_res.get("strain"),
        "confidence": ivive_res.get("confidence"),
        "ivive": ivive_res,
        "disposition": disp.to_dict(),
        "formulation": form_res,
        "applicability_domain": ad.to_dict(),
        "cohort": cohort,
        "warnings": warnings,
        "engine_used": engine_used,
        "engine_requested": requested_engine,
        "model_info": {
            "engine": (
                "mrgsolve (Metrum) 13-compartment perfusion-limited PBPK over IVIVE disposition"
                if engine_used == "mrgsolve"
                else "Hakase kernel PBPK (13-compartment perfusion-limited ODE) over IVIVE disposition"
            ),
            "engine_used": engine_used,
            "cohort_size": cohort_size,
            "seed": seed,
            "time_units": "hours",
            "references": [
                "Rodgers & Rowland 2006 J Pharm Sci 95:1238 (tissue Kp)",
                "Jones & Rowland-Yeo 2013 CPT:PSP 2:e63 (whole-body PBPK)",
                "Baron KT et al. mrgsolve: Simulate from ODE-Based Models (R package)",
            ],
        },
    }


__all__ = ["ArmSpec", "AnimalSpec", "run_arm_exposure"]
