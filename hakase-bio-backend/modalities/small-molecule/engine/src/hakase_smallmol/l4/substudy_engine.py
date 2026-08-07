"""Phase-1 sub-study feasibility — which extra arms this programme can support.

A first-in-human protocol is rarely just SAD and MAD. Five sub-studies are
routinely folded into it, and each one is *gated by a preclinical measurement*
that either exists or does not:

  food effect          only meaningful for an oral route (FDA 2019 food-effect
                       guidance)
  thorough QT / ECG    triggered by a cardiac liability signal (ICH E14/S7B)
  DDI cocktail         triggered by a CYP inhibition or induction signal
                       (FDA 2020 in-vitro DDI guidance)
  renal impairment     triggered when renal clearance is a material fraction of
                       total clearance (FDA 2020 renal-impairment guidance)
  hepatic impairment   triggered when hepatic clearance dominates (FDA 2003
                       hepatic-impairment guidance)

This module answers two separate questions per sub-study and never conflates
them:

  feasible   is the gating input present at all? A missing input makes the
             sub-study *undetermined*, not "not required".
  advised    given the input, does the guideline threshold trigger?

Every trigger is read off the L3 study record — the DDI engine's isoform calls,
the biodistribution elimination split, the safety-pharmacology cardiac block —
so a sub-study recommendation is always traceable to a specific upstream number.
"""

from __future__ import annotations

from typing import Any

# FDA 2020: a renal or hepatic route carrying ≥30% of total clearance warrants a
# dedicated organ-impairment study.
IMPAIRMENT_FRACTION_THRESHOLD = 0.30
# The CYP inhibitor/substrate classifiers return a call at this probability.
CYP_CALL_THRESHOLD = 0.50
# ICH E14 practice: a hERG liability class of Moderate or High triggers an
# intensified cardiac assessment.
CARDIAC_TRIGGER_CLASSES = {"High", "Moderate"}


def _gate(
    *,
    sub_study_id: str,
    name: str,
    guideline: str,
    feasible: bool,
    advised: bool | None,
    rationale: str,
    gating_input: str,
    evidence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": sub_study_id,
        "name": name,
        "guideline": guideline,
        "feasible": feasible,
        "advised": advised,
        "status": (
            "undetermined"
            if not feasible
            else ("advised" if advised else "not triggered")
        ),
        "gating_input": gating_input,
        "rationale": rationale,
        "evidence": evidence or {},
    }


def _food_effect(route: str) -> dict[str, Any]:
    oral = (route or "").strip().upper() == "ORAL"
    return _gate(
        sub_study_id="food_effect",
        name="Food-effect crossover",
        guideline="FDA (2019) Assessing the Effects of Food on Drugs",
        feasible=True,
        advised=oral,
        gating_input="Planned clinical route of administration",
        rationale=(
            "The clinical route is oral, so a fed/fasted crossover at a mid-SAD dose "
            "characterises the food effect before it confounds the MAD."
            if oral
            else f"The planned route is {route.upper()}, so a food effect does not apply."
        ),
        evidence={"planned_route": (route or "").upper()},
    )


def _cardiac(safety_pharmacology: dict[str, Any], safety_margins: dict[str, Any]) -> dict[str, Any]:
    systems = {s.get("system"): s for s in (safety_pharmacology or {}).get("systems", [])}
    cardio = systems.get("Cardiovascular") or {}
    risk_class = cardio.get("herg_risk_class")
    probability = cardio.get("herg_blocker_probability")
    required = (
        ((safety_margins or {}).get("cardiovascular") or {}).get("per_dose_level") or [{}]
    )[0].get("required_herg_ic50_uM")

    if risk_class is None and probability is None:
        return _gate(
            sub_study_id="cardiac_qt",
            name="Intensified cardiac / thorough-QT assessment",
            guideline="ICH E14 / ICH S7B",
            feasible=False,
            advised=None,
            gating_input="A hERG liability call from the safety-pharmacology block",
            rationale=(
                "No hERG model output was available, so the need for an intensified cardiac "
                "assessment is undetermined. A measured patch-clamp IC50 resolves it."
            ),
        )
    triggered = bool(
        (risk_class in CARDIAC_TRIGGER_CLASSES)
        or (isinstance(probability, (int, float)) and probability >= CYP_CALL_THRESHOLD)
    )
    return _gate(
        sub_study_id="cardiac_qt",
        name="Intensified cardiac / thorough-QT assessment",
        guideline="ICH E14 / ICH S7B",
        feasible=True,
        advised=triggered,
        gating_input="hERG liability class and blocker probability",
        rationale=(
            f"The cardiac liability call is {risk_class or 'probability ' + format(probability, '.2f')}, "
            "so concentration–QTc modelling with dense ECG collection should be built into the SAD "
            "rather than run as a separate late study."
            if triggered
            else "No cardiac liability signal reached the trigger, so standard ECG monitoring is "
            "sufficient at this stage."
        ),
        evidence={
            "herg_risk_class": risk_class,
            "herg_blocker_probability": probability,
            "required_herg_ic50_uM_at_starting_dose": required,
        },
    )


def _ddi_cocktail(ddi: dict[str, Any]) -> dict[str, Any]:
    if not (ddi or {}).get("available"):
        return _gate(
            sub_study_id="ddi_cocktail",
            name="DDI cocktail (index-substrate) arm",
            guideline="FDA (2020) In Vitro Drug Interaction Studies",
            feasible=False,
            advised=None,
            gating_input="The L3 CYP/transporter interaction assessment",
            rationale=(
                "No DDI assessment was produced by the animal study, so the need for a cocktail "
                "arm is undetermined."
            ),
        )
    perpetrator = ddi.get("perpetrator") or {}
    flagged = perpetrator.get("flagged_isoforms") or []
    victim = ddi.get("victim") or {}
    victim_risk = victim.get("risk")
    triggered = bool(flagged) or victim_risk in {"high", "moderate"}
    return _gate(
        sub_study_id="ddi_cocktail",
        name="DDI cocktail (index-substrate) arm",
        guideline="FDA (2020) In Vitro Drug Interaction Studies",
        feasible=True,
        advised=triggered,
        gating_input="CYP inhibitor calls and the hepatic clearance fraction",
        rationale=(
            (
                f"Inhibitor calls were returned for {', '.join(flagged)}"
                if flagged
                else f"Victim-side interaction risk is {victim_risk}"
            )
            + ". A cocktail arm characterises the interaction in humans, but the in-vitro Ki and "
            "reaction-phenotyping studies must come first — the classifiers return a call, not a "
            "potency."
            if triggered
            else "No isoform reached the inhibitor call threshold and hepatic clearance does not "
            "dominate, so a cocktail arm is not triggered at this stage."
        ),
        evidence={
            "flagged_isoforms": flagged,
            "highest_perpetrator_risk": perpetrator.get("highest_risk"),
            "victim_risk": victim_risk,
            "fraction_cleared_hepatically": victim.get("fraction_cleared_hepatically"),
        },
    )


def _elimination_fractions(biodistribution: dict[str, Any]) -> dict[str, Any]:
    """Route-of-elimination split from the biodistribution block, top dose group."""
    per_arm = (biodistribution or {}).get("per_arm") or []
    if not per_arm:
        return {}
    routes = (per_arm[-1] or {}).get("elimination_routes") or {}
    return routes if isinstance(routes, dict) else {}


def _impairment(
    kind: str, biodistribution: dict[str, Any], ddi: dict[str, Any]
) -> dict[str, Any]:
    routes = _elimination_fractions(biodistribution)
    fraction = None
    if kind == "renal":
        for key in ("renal_fraction", "fraction_renal", "renal"):
            value = routes.get(key)
            if isinstance(value, (int, float)):
                fraction = float(value)
                break
    else:
        for key in ("hepatic_fraction", "fraction_hepatic", "hepatic"):
            value = routes.get(key)
            if isinstance(value, (int, float)):
                fraction = float(value)
                break
        if fraction is None:
            candidate = ((ddi or {}).get("victim") or {}).get("fraction_cleared_hepatically")
            if isinstance(candidate, (int, float)):
                fraction = float(candidate)

    name = (
        "Renal-impairment sub-study" if kind == "renal" else "Hepatic-impairment sub-study"
    )
    guideline = (
        "FDA (2020) Pharmacokinetics in Patients with Impaired Renal Function"
        if kind == "renal"
        else "FDA (2003) Pharmacokinetics in Patients with Impaired Hepatic Function"
    )
    gating = (
        f"The {kind} fraction of total clearance from the PBPK elimination split"
    )
    if fraction is None:
        return _gate(
            sub_study_id=f"{kind}_impairment",
            name=name,
            guideline=guideline,
            feasible=False,
            advised=None,
            gating_input=gating,
            rationale=(
                f"No {kind} clearance fraction was resolvable from the simulation, so the need "
                "for a dedicated organ-impairment study is undetermined."
            ),
        )
    triggered = fraction >= IMPAIRMENT_FRACTION_THRESHOLD
    return _gate(
        sub_study_id=f"{kind}_impairment",
        name=name,
        guideline=guideline,
        feasible=True,
        advised=triggered,
        gating_input=gating,
        rationale=(
            f"{fraction * 100:.0f}% of clearance is {kind}, at or above the "
            f"{IMPAIRMENT_FRACTION_THRESHOLD * 100:.0f}% threshold, so a dedicated "
            f"{kind}-impairment study is advised before broad patient exposure."
            if triggered
            else f"{fraction * 100:.0f}% of clearance is {kind}, below the "
            f"{IMPAIRMENT_FRACTION_THRESHOLD * 100:.0f}% threshold, so the study is optional."
        ),
        evidence={f"{kind}_clearance_fraction": round(fraction, 4), "elimination_routes": routes},
    )


def assess_sub_studies(
    *,
    route: str,
    study: dict[str, Any],
    safety_pharmacology_margins: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Feasibility and trigger status for every Phase-1 sub-study."""
    biodistribution = study.get("biodistribution") or {}
    ddi = study.get("ddi") or {}
    safety_pharmacology = study.get("safety_pharmacology") or {}

    sub_studies = [
        _food_effect(route),
        _cardiac(safety_pharmacology, safety_pharmacology_margins or {}),
        _ddi_cocktail(ddi),
        _impairment("renal", biodistribution, ddi),
        _impairment("hepatic", biodistribution, ddi),
    ]

    advised = [s for s in sub_studies if s["status"] == "advised"]
    undetermined = [s for s in sub_studies if s["status"] == "undetermined"]

    return {
        "available": True,
        "sub_studies": sub_studies,
        "summary": {
            "n_advised": len(advised),
            "n_undetermined": len(undetermined),
            "advised": [s["name"] for s in advised],
            "undetermined": [s["name"] for s in undetermined],
        },
        "thresholds": {
            "impairment_clearance_fraction": IMPAIRMENT_FRACTION_THRESHOLD,
            "cyp_call": CYP_CALL_THRESHOLD,
            "cardiac_trigger_classes": sorted(CARDIAC_TRIGGER_CLASSES),
        },
        "model": "Guideline trigger rules applied to the L3 disposition and liability blocks",
        "provenance": "regulatory practice over derived inputs",
        "limitations": (
            "An 'advised' status means a guideline trigger fired on a predicted input, not that "
            "the sub-study is mandated. An 'undetermined' status means the gating measurement is "
            "missing — it must never be read as 'not required'."
        ),
    }


__all__ = [
    "CARDIAC_TRIGGER_CLASSES",
    "CYP_CALL_THRESHOLD",
    "IMPAIRMENT_FRACTION_THRESHOLD",
    "assess_sub_studies",
]
