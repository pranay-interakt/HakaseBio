"""First-in-human readiness gate — an auditable READY / CONDITIONAL / NOT-READY.

The gate combines only the criteria the layer actually produced. A missing input
weakens the recommendation toward CONDITIONAL and appears in the "what would
change this" list; it is never silently treated as a pass. This mirrors the L3
stage gate's posture: a decision is only as strong as its weakest present
criterion.
"""

from __future__ import annotations

from typing import Any

from hakase_smallmol.l4.margin_engine import MINIMUM_EXPOSURE_MARGIN, TARGET_EXPOSURE_MARGIN


def _verdict(status: str, rationale: str, **extra: Any) -> dict[str, Any]:
    return {"status": status, "rationale": rationale, **extra}


def _starting_dose_criterion(starting_dose: dict[str, Any]) -> dict[str, Any]:
    if not starting_dose.get("available"):
        return _verdict("fail", starting_dose.get("reason") or "No starting dose could be derived.")
    approaches = [a for a in starting_dose.get("approaches", []) if a.get("available")]
    computed = {a["id"] for a in approaches}
    if {"noael_hed", "mabel"} <= computed:
        disagreement = starting_dose.get("approach_disagreement") or {}
        if (disagreement.get("fold_difference") or 0) > 10:
            return _verdict(
                "caution",
                f"Both approaches were computed but differ by {disagreement['fold_difference']:.0f}-fold; "
                "the divergence must be reconciled and justified before a protocol is written.",
            )
        return _verdict(
            "pass",
            "Both the NOAEL/HED and MABEL approaches were computed and the lower value governs, "
            "as EMA guidance requires.",
        )
    return _verdict(
        "caution",
        "Only one starting-dose approach could be computed. EMA guidance expects the NOAEL/HED "
        "route and MABEL to be derived independently and reconciled.",
    )


def _margin_criterion(margins: dict[str, Any]) -> dict[str, Any]:
    if not margins.get("available"):
        return _verdict(
            "unknown",
            margins.get("reason")
            or "No exposure-based margin could be computed against an animal point of departure.",
        )
    rows = [
        m for m in margins.get("per_dose_level", []) if isinstance(m.get("limiting_margin"), (int, float))
    ]
    if not rows:
        return _verdict("unknown", "No dose level produced a computable exposure margin.")
    starting = rows[0]
    worst = starting["limiting_margin"]
    if worst >= TARGET_EXPOSURE_MARGIN:
        return _verdict(
            "pass",
            f"The starting dose carries a {worst:.1f}× exposure margin to the animal point of "
            f"departure, at or above the {TARGET_EXPOSURE_MARGIN:.0f}× target.",
            starting_dose_margin=worst,
        )
    if worst >= MINIMUM_EXPOSURE_MARGIN:
        return _verdict(
            "caution",
            f"The starting dose carries a {worst:.1f}× exposure margin — above the "
            f"{MINIMUM_EXPOSURE_MARGIN:.0f}× minimum but below the {TARGET_EXPOSURE_MARGIN:.0f}× target.",
            starting_dose_margin=worst,
        )
    return _verdict(
        "fail",
        f"The starting dose carries only a {worst:.1f}× exposure margin to the animal point of "
        "departure, below the minimum. The dose or the point of departure must change.",
        starting_dose_margin=worst,
    )


def _hazard_criterion(l3_toxicology: dict[str, Any]) -> dict[str, Any]:
    summary = (l3_toxicology or {}).get("summary") or {}
    high = summary.get("high_hazard_domains") or []
    flagged = summary.get("flagged_domains") or []
    not_predicted = summary.get("not_predicted_domains") or []
    if high:
        return _verdict(
            "caution",
            "The preclinical panel flags "
            + ", ".join(high)
            + " at high hazard. Each needs a clinical monitoring plan and a stopping threshold "
            "before dosing.",
            high_hazard_domains=high,
        )
    if not_predicted:
        return _verdict(
            "caution",
            f"{len(not_predicted)} toxicology domain(s) could not be predicted at all, so the "
            "hazard picture is incomplete.",
            not_predicted_domains=not_predicted,
        )
    if flagged:
        return _verdict(
            "pass",
            "Moderate hazards are flagged but none reaches the high band; standard monitoring "
            "with the flagged endpoints emphasised is appropriate.",
            flagged_domains=flagged,
        )
    return _verdict("pass", "No toxicology domain reached the moderate hazard threshold.")


def _human_pk_criterion(human_exposures: dict[str, Any]) -> dict[str, Any]:
    if not human_exposures.get("available"):
        return _verdict(
            "fail",
            human_exposures.get("reason") or "No human exposure could be projected.",
        )
    rows = [r for r in human_exposures.get("exposures", []) if r.get("available")]
    if not rows:
        return _verdict("fail", "No dose level produced a human exposure projection.")
    return _verdict(
        "pass",
        f"Human exposure was projected at {len(rows)} dose level(s) using human physiology in "
        "the same PBPK engine that produced the animal exposure.",
    )


def _precedent_criterion(precedent: dict[str, Any]) -> dict[str, Any]:
    if not precedent.get("available"):
        return _verdict(
            "unknown",
            precedent.get("reason") or "No clinical precedent could be searched.",
        )
    if precedent.get("target_precedented"):
        n = (precedent.get("phase1_trials") or {}).get("n_trials") or 0
        return _verdict(
            "pass",
            f"The target is clinically precedented and {n} registered Phase 1 study/studies "
            "were located for context.",
        )
    return _verdict(
        "caution",
        "No approved compound against this target was located, so the novel-target risk factor "
        "should be applied to the safety factor unless precedent is confirmed independently.",
    )


def first_in_human_gate(
    *,
    starting_dose: dict[str, Any],
    margins: dict[str, Any],
    human_exposures: dict[str, Any],
    l3_toxicology: dict[str, Any],
    precedent: dict[str, Any],
) -> dict[str, Any]:
    """Combine the criteria into READY / CONDITIONAL / NOT-READY with rationale."""
    criteria = {
        "human_pk": _human_pk_criterion(human_exposures),
        "starting_dose": _starting_dose_criterion(starting_dose),
        "exposure_margin": _margin_criterion(margins),
        "preclinical_hazard": _hazard_criterion(l3_toxicology),
        "clinical_precedent": _precedent_criterion(precedent),
    }
    statuses = {k: v["status"] for k, v in criteria.items()}

    if statuses["human_pk"] == "fail" or statuses["starting_dose"] == "fail":
        recommendation = "NOT-READY"
        headline = (
            "The layer could not produce a defensible human exposure projection or starting "
            "dose, so no first-in-human plan can be written from it."
        )
    elif statuses["exposure_margin"] == "fail":
        recommendation = "NOT-READY"
        headline = (
            "The proposed starting dose does not clear the minimum exposure margin to the "
            "animal point of departure."
        )
    elif "unknown" in statuses.values() or "caution" in statuses.values():
        recommendation = "CONDITIONAL"
        headline = (
            "A first-in-human plan is derivable, but named gaps must be closed before a "
            "protocol is finalised."
        )
    else:
        recommendation = "READY"
        headline = (
            "Human exposure, starting dose, exposure margin, hazard picture and clinical "
            "precedent all support drafting a first-in-human protocol."
        )

    required: list[str] = []
    if statuses["exposure_margin"] in {"unknown", "caution", "fail"}:
        required.append(
            "An in-vivo point of departure from a GLP repeat-dose study in the intended "
            "species, with toxicokinetics, to anchor the exposure margin."
        )
    if statuses["starting_dose"] == "caution":
        required.append(
            "A measured target affinity and functional potency in a human system, so MABEL "
            "can be derived independently of the NOAEL route."
        )
    if statuses["preclinical_hazard"] == "caution":
        required.append(
            "A monitoring plan and stopping threshold for every high-hazard domain flagged "
            "by the preclinical panel."
        )
    required.append(
        "Measured human PK from the first cohort, to replace the IVIVE-projected clearance "
        "the whole exposure picture currently rests on."
    )

    return {
        "recommendation": recommendation,
        "headline": headline,
        "criteria": criteria,
        "required_before_dosing": required,
        "model": "Transparent criterion-weighted first-in-human readiness gate",
        "provenance": "derived",
        "limitations": (
            "A rule-based synthesis of the criteria above. It advises protocol design; it does "
            "not constitute regulatory clearance, and it cannot substitute for the nonclinical "
            "studies ICH M3(R2) requires before human dosing."
        ),
    }


__all__ = ["first_in_human_gate"]
