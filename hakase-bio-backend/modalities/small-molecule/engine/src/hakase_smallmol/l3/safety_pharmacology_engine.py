"""ICH S7A/S7B safety-pharmacology core battery, referenced to real exposure.

The core battery asks three questions before first-in-human: does the compound
disturb the cardiovascular system, the central nervous system, or respiration at
exposures the clinic will see? Each assessment here pairs the relevant liability
model with the simulated free concentration at the site of action, because a
liability without exposure is not a finding.

Where a quantitative margin is defensible it is computed and named. Where the
underlying model returns a class rather than a potency (the hERG classifier, for
instance) the module says what measurement would close the gap instead of
inventing an IC50.
"""

from __future__ import annotations

from typing import Any

from hakase_smallmol.l3.model_panel import ModelPanel

# ICH S7B / CiPA practice: a ≥30-fold margin between the hERG IC50 and the free
# clinical Cmax is the conventional threshold for low torsadogenic concern.
HERG_TARGET_MARGIN = 30.0
# Brain:plasma AUC ratio above which CNS effects must be actively excluded.
CNS_EXPOSURE_RATIO = 0.3


def _top_arm(arm_results: list[dict[str, Any]]) -> dict[str, Any] | None:
    return next((a for a in reversed(arm_results) if a.get("available")), None)


def free_plasma_concentrations(
    arm_result: dict[str, Any], mw_g_per_mol: float | None
) -> dict[str, Any]:
    """Free (unbound) plasma Cmax and Cavg in µM — the safety-pharmacology unit.

    Ion-channel and receptor potencies are reported in µM against free drug, so
    a total mg/L plasma concentration cannot be compared to them directly.
    """
    if not (mw_g_per_mol and mw_g_per_mol > 0):
        return {"available": False, "reason": "Molecular weight is required for µM conversion."}
    cohort = arm_result.get("cohort") or {}
    ep = (cohort.get("endpoints") or {}).get("plasma") or {}
    c_max = (ep.get("c_max") or {}).get("median")
    auc = (ep.get("auc") or {}).get("median")
    fu = (((arm_result.get("ivive") or {}).get("inputs") or {}).get("fu_plasma") or {}).get("value")
    duration = ((arm_result.get("arm") or {}).get("duration_h")) or None
    if not isinstance(c_max, (int, float)) or not isinstance(fu, (int, float)):
        return {
            "available": False,
            "reason": "The arm did not return both a plasma Cmax and an unbound fraction.",
        }
    to_uM = 1000.0 / mw_g_per_mol  # mg/L → µM
    out: dict[str, Any] = {
        "available": True,
        "fu_plasma": round(float(fu), 5),
        "total_cmax_uM": round(float(c_max) * to_uM, 5),
        "free_cmax_uM": round(float(c_max) * float(fu) * to_uM, 6),
    }
    if isinstance(auc, (int, float)) and duration:
        c_avg = float(auc) / float(duration)
        out["total_cavg_uM"] = round(c_avg * to_uM, 5)
        out["free_cavg_uM"] = round(c_avg * float(fu) * to_uM, 6)
    return out


def _cardiovascular(
    panel: ModelPanel, arm_result: dict[str, Any], free: dict[str, Any]
) -> dict[str, Any]:
    """Cardiovascular assessment: hERG liability against free Cmax."""
    herg_prob = panel.probability("hERG")
    block: dict[str, Any] = {
        "system": "Cardiovascular",
        "guideline": "ICH S7A core battery + ICH S7B (delayed ventricular repolarisation)",
        "study_equivalent": (
            "Conscious telemetered dog or non-human primate: arterial pressure, heart rate, "
            "ECG intervals (PR, QRS, QT/QTc), arrhythmia scoring"
        ),
        "herg_blocker_probability": herg_prob,
        "free_cmax_uM": free.get("free_cmax_uM"),
        "target_margin": HERG_TARGET_MARGIN,
    }
    try:
        from hakase_smallmol.cardiotox.cardiotox import predict_cardiotox

        res = predict_cardiotox(panel.smiles)
        prediction = (res or {}).get("prediction") or {}
        block["herg_risk_class"] = prediction.get("risk_class")
        block["herg_ic50_band_uM"] = prediction.get("ic50_band")
        block["model"] = (res or {}).get("model_info", {}).get("engine") or "Hakase CardioTox"
        block["applicability_domain"] = prediction.get("applicability_domain") or res.get(
            "applicability_domain"
        )
    except Exception as exc:  # noqa: BLE001
        block["model_error"] = str(exc)

    free_cmax = free.get("free_cmax_uM")
    if isinstance(free_cmax, (int, float)) and free_cmax > 0:
        block["required_herg_ic50_uM"] = round(free_cmax * HERG_TARGET_MARGIN, 4)
        block["margin_statement"] = (
            f"A {HERG_TARGET_MARGIN:.0f}× ICH S7B margin at this exposure requires a measured "
            f"hERG IC50 above {free_cmax * HERG_TARGET_MARGIN:.3g} µM."
        )
    if herg_prob is None:
        block["assessment"] = "not_predicted"
        block["rationale"] = "No hERG model output was available for this structure."
    elif herg_prob >= 0.7:
        block["assessment"] = "concern"
        block["rationale"] = (
            f"High hERG blocker probability ({herg_prob:.2f}). A patch-clamp hERG IC50 and an "
            "in-vivo QT assessment are required before dose escalation."
        )
    elif herg_prob >= 0.4:
        block["assessment"] = "monitor"
        block["rationale"] = (
            f"Intermediate hERG blocker probability ({herg_prob:.2f}); confirm with a "
            "patch-clamp IC50 to establish the exposure margin."
        )
    else:
        block["assessment"] = "low_concern"
        block["rationale"] = (
            f"Low hERG blocker probability ({herg_prob:.2f}); the standard telemetry study "
            "remains required but no specific torsadogenic hypothesis is raised."
        )
    block["next_measurement"] = (
        "Manual or automated patch-clamp hERG IC50 (and, if positive, the CiPA multi-channel "
        "panel: Nav1.5 peak/late, Cav1.2, Kv4.3, KCNQ1) — the classifier gives a class, not a "
        "potency, so no numeric margin can be claimed without it."
    )
    block["provenance"] = "ml + derived exposure"
    return block


def _central_nervous(
    panel: ModelPanel, biodistribution: dict[str, Any], free: dict[str, Any]
) -> dict[str, Any]:
    """CNS assessment: does the brain actually see drug, and what would be scored."""
    cns = ((biodistribution or {}).get("per_arm") or [{}])[-1].get("cns_penetration") or {}
    ratio = cns.get("brain_plasma_auc_ratio")
    bbb = panel.probability("BBB_Martins")
    exposed = isinstance(ratio, (int, float)) and ratio >= CNS_EXPOSURE_RATIO
    block: dict[str, Any] = {
        "system": "Central nervous system",
        "guideline": "ICH S7A core battery (CNS)",
        "study_equivalent": (
            "Modified Irwin screen / functional observational battery in the rat: motor "
            "activity, gait, reflexes, tremor, convulsions, body temperature"
        ),
        "brain_plasma_auc_ratio": ratio,
        "bbb_penetration_probability": bbb,
        "brain_exposure_threshold": CNS_EXPOSURE_RATIO,
        "brain_exposed": exposed,
        "pgp_substrate_probability": panel.probability("Pgp_Broccatelli"),
        "provenance": "derived exposure + ml",
    }
    if ratio is None and bbb is None:
        block["assessment"] = "not_predicted"
        block["rationale"] = "Neither a brain exposure simulation nor a BBB model output was available."
    elif exposed:
        block["assessment"] = "monitor"
        block["rationale"] = (
            f"The brain compartment reaches {ratio:.2g}× plasma exposure, so CNS effects cannot "
            "be excluded on exposure grounds; the FOB must be read carefully."
        )
    else:
        block["assessment"] = "low_concern"
        block["rationale"] = (
            "Simulated brain exposure is low relative to plasma, so CNS findings would be "
            "unexpected — but the perfusion-limited brain compartment carries no efflux term, "
            "so this is a modelling argument, not a measurement."
        )
    block["next_measurement"] = (
        "Rodent brain:plasma Kp,uu by microdialysis or brain-homogenate binding, which the "
        "perfusion-limited model cannot substitute for."
    )
    return block


def _respiratory(panel: ModelPanel, biodistribution: dict[str, Any]) -> dict[str, Any]:
    """Respiratory assessment: pulmonary exposure and phospholipidosis liability."""
    per_arm = (biodistribution or {}).get("per_arm") or []
    lung = None
    if per_arm:
        lung = next((r for r in per_arm[-1].get("tissues", []) if r["organ"] == "lung"), None)
    bsep = panel.bsep if isinstance(panel.bsep, dict) else {}
    pl = bsep.get("phospholipidosis") or {}
    block: dict[str, Any] = {
        "system": "Respiratory",
        "guideline": "ICH S7A core battery (respiratory)",
        "study_equivalent": (
            "Whole-body plethysmography in the conscious rat: respiratory rate, tidal volume, "
            "minute volume"
        ),
        "lung_plasma_auc_ratio": (lung or {}).get("tissue_plasma_auc_ratio"),
        "lung_cmax_mg_per_l": (lung or {}).get("c_max_median"),
        "phospholipidosis_risk_class": pl.get("risk_class"),
        "phospholipidosis_score": pl.get("score"),
        "cad_positive": pl.get("cad_positive"),
        "provenance": "derived exposure + structural-alert",
    }
    if pl.get("risk_class") in {"High", "Moderate"}:
        block["assessment"] = "monitor"
        block["rationale"] = (
            f"Cationic-amphiphilic profile gives a {pl['risk_class'].lower()} phospholipidosis "
            "risk; alveolar foamy macrophages are the finding to score."
        )
        block["next_measurement"] = pl.get("recommended_assay")
    elif pl.get("risk_class"):
        block["assessment"] = "low_concern"
        block["rationale"] = (
            "Physicochemical profile is not consistent with pulmonary phospholipidosis; no "
            "specific respiratory hypothesis is raised beyond the standard battery."
        )
    else:
        block["assessment"] = "not_predicted"
        block["rationale"] = "No phospholipidosis model output was available."
    return block


def compute_safety_pharmacology(
    *,
    panel: ModelPanel,
    arm_results: list[dict[str, Any]],
    biodistribution: dict[str, Any],
) -> dict[str, Any]:
    """The ICH S7A core battery, referenced to the top-dose exposure."""
    top = _top_arm(arm_results)
    if not top:
        return {
            "available": False,
            "reason": "No dose group produced an exposure simulation to reference.",
        }
    free = free_plasma_concentrations(top, panel.mw_g_per_mol)
    systems = [
        _cardiovascular(panel, top, free),
        _central_nervous(panel, biodistribution, free),
        _respiratory(panel, biodistribution),
    ]
    concerns = [s for s in systems if s.get("assessment") == "concern"]
    monitors = [s for s in systems if s.get("assessment") == "monitor"]
    return {
        "available": True,
        "reference_arm": (top.get("arm") or {}).get("label"),
        "reference_dose_mg_per_kg": (top.get("arm") or {}).get("dose_mg_per_kg"),
        "free_concentrations": free,
        "systems": systems,
        "summary": {
            "n_concern": len(concerns),
            "n_monitor": len(monitors),
            "systems_of_concern": [s["system"] for s in concerns],
            "systems_to_monitor": [s["system"] for s in monitors],
            "overall": (
                "concern"
                if concerns
                else ("monitor" if monitors else "no core-battery hypothesis raised")
            ),
        },
        "model": "ICH S7A/S7B core battery mapped onto the liability models + PBPK free exposure",
        "provenance": "ml + derived",
        "limitations": (
            "This is a pre-study risk assessment, not a substitute for the in-vivo core "
            "battery. Free concentrations come from the PBPK cohort and an ML unbound "
            "fraction; ion-channel potencies are classifier outputs, not measured IC50s."
        ),
    }


__all__ = [
    "CNS_EXPOSURE_RATIO",
    "HERG_TARGET_MARGIN",
    "compute_safety_pharmacology",
    "free_plasma_concentrations",
]
