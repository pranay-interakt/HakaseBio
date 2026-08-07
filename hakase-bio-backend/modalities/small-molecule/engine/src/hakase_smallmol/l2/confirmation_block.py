"""Layer-2 Stage 9 — the confirmation block.

This stage runs no model.  It is a **rollup**: it reads the status of every
Confirmation stage that actually executed and turns that into a set of named
conditions, an evidence-completeness count, and a confirmation verdict.

Severity has the same meaning as the Layer-3 stage gate:

  * ``block`` — Confirmation cannot be considered complete. The underlying
    evidence has to change; this is not acknowledgeable from the UI.
  * ``warn``  — Confirmation may proceed, but the residual risk is named and
    must be carried forward into the Layer-3 gate.
  * ``pass``  — the condition was evaluated and is satisfied.

Every condition is derived from a status or a number that another stage really
produced.  Where the evidence needed to evaluate a condition is absent, that
absence *is* the condition — it is never scored as a pass.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

# A computed margin at or below this fold-ratio means the safety and efficacy
# concentrations overlap. Reported as a block because no amount of reviewer
# acknowledgement makes overlapping concentrations acceptable at this stage.
_CRITICAL_MARGIN_FOLD = 3.0

# Layer-1 verdicts that require a recorded manual review before Confirmation
# may be declared complete.
_VERDICTS_NEEDING_REVIEW = frozenset({"WATCH", "NO-GO"})


def _condition(code: str, severity: str, title: str, detail: str, **extra: Any) -> dict[str, Any]:
    return {
        "code": code,
        "severity": severity,
        "title": title,
        "detail": detail,
        "acknowledgeable": severity == "warn",
        **extra,
    }


def _is_available(envelope: Any) -> bool:
    if not isinstance(envelope, dict):
        return False
    if envelope.get("available") is False or envelope.get("ml_available") is False:
        return False
    return envelope.get("source") not in {"fallback", "unavailable", "insufficient-input"}


def build_confirmation_block(
    *,
    l1: dict[str, Any],
    stage_results: dict[str, Any],
) -> dict[str, Any]:
    """Roll every executed Confirmation stage into one reviewable decision.

    ``stage_results`` maps a stage id to the *result payload* of that stage
    (not the wrapper envelope), so this function reads exactly what the models
    produced.
    """
    conditions: list[dict[str, Any]] = []

    # ── Layer-1 carry-over ────────────────────────────────────────────────
    verdict_block = l1.get("verdict") or {}
    verdict = str(verdict_block.get("verdict") or "").upper()
    review = l1.get("review") or {}
    if not verdict:
        conditions.append(
            _condition(
                "L1_VERDICT_MISSING",
                "block",
                "No Layer 1 verdict was carried into Confirmation",
                "The Confirmation block summarises Layer 1 evidence. Without a recorded Layer 1 gate there is nothing to confirm.",
            )
        )
    elif verdict in _VERDICTS_NEEDING_REVIEW and not review:
        conditions.append(
            _condition(
                "L1_REVIEW_MISSING",
                "block",
                f"Layer 1 returned {verdict} and no manual review was recorded",
                "A reviewer decision and rationale must exist before a non-GO Layer 1 result can be confirmed.",
                layer_1_verdict=verdict,
            )
        )
    else:
        conditions.append(
            _condition(
                "L1_VERDICT_PRESENT",
                "pass",
                f"Layer 1 verdict carried forward: {verdict}",
                "The recorded Layer 1 gate and any reviewer decision are attached to this confirmation.",
                layer_1_verdict=verdict,
                recorded_review=review.get("effective_verdict"),
            )
        )

    # ── Target druggability (Stage 1) ─────────────────────────────────────
    druggability = stage_results.get("1")
    if _is_available(druggability):
        prediction = (druggability or {}).get("prediction") or {}
        conditions.append(
            _condition(
                "TARGET_DRUGGABILITY",
                "pass",
                "Target druggability was returned",
                f"Class: {prediction.get('druggability_class')}.",
                druggability_class=prediction.get("druggability_class"),
            )
        )
    else:
        conditions.append(
            _condition(
                "TARGET_DRUGGABILITY_MISSING",
                "warn",
                "Target druggability was not returned",
                "Confirmation proceeds without a druggability assessment for the resolved target.",
            )
        )

    # ── Target engagement (Stage 7) ───────────────────────────────────────
    engagement = stage_results.get("7")
    if not _is_available(engagement):
        conditions.append(
            _condition(
                "ENGAGEMENT_MISSING",
                "block",
                "Target engagement could not be projected",
                "Without an affinity anchor there is no efficacy concentration, so no margin and no confirmation is possible.",
                missing=(engagement or {}).get("missing"),
            )
        )
    else:
        anchor = (engagement or {}).get("affinity_anchor") or {}
        if anchor.get("provenance") == "measured":
            conditions.append(
                _condition(
                    "ENGAGEMENT_MEASURED",
                    "pass",
                    "Target engagement is anchored on a measured affinity",
                    f"Anchor: {anchor.get('activity_type')} from {anchor.get('source')}.",
                )
            )
        elif anchor.get("applicability_domain") == "out_of_domain":
            conditions.append(
                _condition(
                    "ENGAGEMENT_OUT_OF_DOMAIN",
                    "block",
                    "The affinity anchor is a prediction made outside the model's applicability domain",
                    str(
                        anchor.get("applicability_rationale")
                        or "The pair sits outside the affinity model's training regime."
                    )
                    + " A measured Kd or Ki is required before any margin derived from it is used.",
                )
            )
        else:
            conditions.append(
                _condition(
                    "ENGAGEMENT_PREDICTED_ONLY",
                    "warn",
                    "Target engagement is anchored on a predicted affinity",
                    "The efficacy concentration derives from a model prediction, not a measurement. A measured Kd or Ki is required before this anchor is relied on.",
                    applicability_domain=anchor.get("applicability_domain"),
                )
            )
        if anchor.get("affinity_is_apparent"):
            conditions.append(
                _condition(
                    "ENGAGEMENT_APPARENT_POTENCY",
                    "warn",
                    "The affinity anchor is an apparent potency, not an equilibrium constant",
                    "IC50/EC50 was used without a Cheng-Prusoff correction because the assay substrate concentration and Km are not recorded.",
                )
            )

    # ── Therapeutic index (Stage 8) ───────────────────────────────────────
    index = stage_results.get("8")
    if _is_available(index):
        for margin in (index or {}).get("computed_margins") or []:
            fold = margin.get("margin_fold")
            if isinstance(fold, (int, float)) and fold < _CRITICAL_MARGIN_FOLD:
                conditions.append(
                    _condition(
                        f"MARGIN_CRITICAL_{str(margin.get('id') or 'unknown').upper()}",
                        "block",
                        f"{margin.get('label')} is {fold}-fold",
                        f"Safety and efficacy concentrations overlap below {_CRITICAL_MARGIN_FOLD}-fold.",
                        margin_fold=fold,
                    )
                )
            elif isinstance(fold, (int, float)) and fold < 10.0:
                conditions.append(
                    _condition(
                        f"MARGIN_NARROW_{str(margin.get('id') or 'unknown').upper()}",
                        "warn",
                        f"{margin.get('label')} is {fold}-fold",
                        "A margin below 10-fold is narrow and requires a measured confirmation before progression.",
                        margin_fold=fold,
                    )
                )
        blocked = (index or {}).get("not_computable") or []
        if blocked:
            conditions.append(
                _condition(
                    "MARGINS_NOT_COMPUTABLE",
                    "warn",
                    f"{len(blocked)} safety margin(s) could not be computed",
                    "; ".join(
                        f"{item.get('label')} needs {item.get('required_measurement')}"
                        for item in blocked
                    ),
                    blocked_margins=[item.get("id") for item in blocked],
                )
            )
        for liability in (index or {}).get("categorical_liabilities") or []:
            if liability.get("active"):
                conditions.append(
                    _condition(
                        f"LIABILITY_{str(liability.get('name') or 'signal').upper().replace(' ', '_')[:40]}",
                        "warn",
                        f"Active categorical liability: {liability.get('name')}",
                        str(liability.get("signal") or "The model reported an active signal."),
                        probability=liability.get("probability"),
                    )
                )
    else:
        conditions.append(
            _condition(
                "THERAPEUTIC_INDEX_MISSING",
                "warn",
                "No therapeutic-index ranking was produced",
                "Confirmation proceeds without a ranked margin table.",
            )
        )

    # ── Disposition (Stage 6) ─────────────────────────────────────────────
    if _is_available(stage_results.get("6")):
        conditions.append(
            _condition(
                "IVIVE_PRESENT",
                "pass",
                "An IVIVE pharmacokinetic projection was returned",
                "Clearance, half-life and distribution volume are available for the Layer-3 handoff.",
            )
        )
    else:
        conditions.append(
            _condition(
                "IVIVE_MISSING",
                "warn",
                "No IVIVE pharmacokinetic projection was returned",
                "Layer 3 will have to resolve disposition parameters from Layer 1 alone.",
            )
        )

    # ── Physical-simulation stages (2 and 5) ──────────────────────────────
    for stage_id, label in (("2", "Molecular docking"), ("5", "Free-energy refinement")):
        if _is_available(stage_results.get(stage_id)):
            conditions.append(
                _condition(
                    f"PHYSICAL_{stage_id}_PRESENT",
                    "pass",
                    f"{label} returned a result",
                    "A structure-based result is attached to this confirmation.",
                )
            )
        else:
            conditions.append(
                _condition(
                    f"PHYSICAL_{stage_id}_ABSENT",
                    "warn",
                    f"{label} was not run",
                    "This is an optional, explicitly dispatched job. Its absence means no structure-based evidence supports the affinity anchor.",
                )
            )

    blocks = [item for item in conditions if item["severity"] == "block"]
    warnings = [item for item in conditions if item["severity"] == "warn"]
    passes = [item for item in conditions if item["severity"] == "pass"]

    if blocks:
        verdict_label = "NOT-CONFIRMED"
        headline = f"{len(blocks)} blocking condition(s) prevent confirmation."
    elif warnings:
        verdict_label = "CONFIRMED-WITH-RESERVATIONS"
        headline = f"Confirmed with {len(warnings)} named reservation(s) to carry into Layer 3."
    else:
        verdict_label = "CONFIRMED"
        headline = "Every evaluated confirmation condition is satisfied."

    evaluated_stages = ["1", "2", "3", "4", "5", "6", "7", "8"]
    available_stages = [sid for sid in evaluated_stages if _is_available(stage_results.get(sid))]

    return {
        "available": True,
        "source": "confirmation-block",
        "owner": "hakase_smallmol.l2.confirmation_block",
        "computed_at": datetime.now(UTC).isoformat(),
        "verdict": verdict_label,
        "headline": headline,
        "conditions": conditions,
        "counts": {
            "block": len(blocks),
            "warn": len(warnings),
            "pass": len(passes),
        },
        "evidence_completeness": {
            "stages_evaluated": len(evaluated_stages),
            "stages_with_a_usable_result": len(available_stages),
            "stages_available": available_stages,
            "note": (
                "Completeness counts stages that returned a usable model result. "
                "It is a coverage measure, not a quality or confidence score."
            ),
        },
        "carry_forward": [
            {"code": item["code"], "title": item["title"], "severity": item["severity"]}
            for item in blocks + warnings
        ],
        "limitations": [
            "This stage runs no model. It restates the status of stages that ran "
            "and applies named severity rules to them.",
            "A CONFIRMED verdict means every condition this platform can evaluate "
            "is satisfied. It is not a statement about conditions the platform "
            "cannot evaluate, and it is not a preclinical safety conclusion.",
        ],
    }
