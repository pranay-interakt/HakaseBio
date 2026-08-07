"""Stage-gate recommendation — a transparent, evidence-weighted GO/NO-GO.

The gate combines only the signals the pipeline actually produced, each as an
explicit criterion with its own verdict and rationale. It never manufactures a
GO on thin evidence: missing evidence yields CONDITIONAL with a value-of-
information note (what to measure next), and a hard applicability/exposure
failure yields NO-GO. Every threshold is named and surfaced, not hidden.

This mirrors the belief/plausibility posture of the kernel decision module
(``platform/kernel/decision``): a decision is only as strong as the weakest
criterion whose evidence is actually present.
"""

from __future__ import annotations

from typing import Any

# Named, surfaced thresholds (tunable; not hidden constants).
THRESHOLDS = {
    "min_average_occupancy_for_go": 0.5,  # target engagement at an efficacious arm
    "min_noael_margin_for_go": 10.0,  # dose margin to the (allometric) NOAEL
    "borderline_noael_margin": 3.0,  # below this → safety concern
}


def _verdict(status: str, rationale: str, **extra: Any) -> dict[str, Any]:
    return {"status": status, "rationale": rationale, **extra}


def _domain_criterion(arm_results: list[dict[str, Any]]) -> dict[str, Any]:
    any_available = any(a.get("available") for a in arm_results)
    if not any_available:
        reasons = [a.get("reason") for a in arm_results if a.get("reason")]
        return _verdict(
            "fail",
            "No dose group produced a valid exposure projection "
            + (f"({reasons[0]})" if reasons else "(applicability or input gate failed)."),
        )
    # Low-confidence cross-species flag?
    low_conf = [
        a
        for a in arm_results
        if a.get("available") and (a.get("confidence") or {}).get("level") == "low"
    ]
    if low_conf:
        return _verdict(
            "caution",
            "Exposure projected, but flagged low-confidence (e.g. non-human species driven by "
            "human-trained ML clearance). Treat quantitative values as directional.",
        )
    return _verdict("pass", "Compound is in the applicability domain and exposure was projected.")


def _coverage_criterion(pkpd: dict[str, Any]) -> dict[str, Any]:
    per_arm = pkpd.get("per_arm") or []
    covered = []
    for arm in per_arm:
        tc = arm.get("target_coverage") or {}
        if tc.get("available"):
            covered.append((arm.get("arm"), tc.get("average_occupancy") or 0.0))
    if not covered:
        return _verdict(
            "unknown",
            "Target coverage could not be evaluated (no potency available); efficacy adequacy is "
            "not established.",
        )
    best = max(covered, key=lambda kv: kv[1])
    thr = THRESHOLDS["min_average_occupancy_for_go"]
    if best[1] >= thr:
        return _verdict(
            "pass",
            f"Adequate target engagement: average occupancy {best[1]:.0%} at the '{(best[0] or {}).get('label')}' "
            f"arm meets the ≥{thr:.0%} threshold.",
            best_average_occupancy=best[1],
        )
    return _verdict(
        "fail",
        f"Insufficient target engagement: best average occupancy {best[1]:.0%} is below the "
        f"≥{thr:.0%} threshold across the simulated doses.",
        best_average_occupancy=best[1],
    )


def _safety_criterion(safety: dict[str, Any]) -> dict[str, Any]:
    margins = safety.get("per_arm_margins") or []
    values = [
        m.get("margin_to_allometric_noael") for m in margins if m.get("margin_to_allometric_noael")
    ]
    hazard = [
        h
        for h in (safety.get("hazard_flags") or [])
        if str(h.get("signal") or "").lower() in {"high", "positive", "flag", "alert"}
    ]
    if not values:
        base = _verdict(
            "unknown",
            "No NOAEL/LD50 anchor located, so a quantitative therapeutic-index margin could not be "
            "computed; only qualitative hazard flags are available.",
        )
        if hazard:
            base["hazard_flags"] = [h.get("endpoint") for h in hazard]
        return base
    worst = min(values)
    thr = THRESHOLDS["min_noael_margin_for_go"]
    borderline = THRESHOLDS["borderline_noael_margin"]
    if worst >= thr:
        v = _verdict(
            "pass",
            f"Comfortable safety margin: lowest NOAEL margin {worst:.1f}× ≥ {thr:.0f}× target.",
        )
    elif worst >= borderline:
        v = _verdict(
            "caution",
            f"Modest safety margin: lowest NOAEL margin {worst:.1f}× is between {borderline:.0f}× and {thr:.0f}×.",
        )
    else:
        v = _verdict(
            "fail",
            f"Narrow safety margin: lowest NOAEL margin {worst:.1f}× is below {borderline:.0f}×.",
        )
    if hazard:
        v["hazard_flags"] = [h.get("endpoint") for h in hazard]
    return v


def _evidence_criterion(evidence: dict[str, Any]) -> dict[str, Any]:
    sources = evidence.get("sources_with_data") or []
    if sources:
        return _verdict("pass", f"Public animal evidence located from: {', '.join(sources)}.")
    return _verdict(
        "unknown",
        "No public animal PK/tox evidence located for the compound or near analogues; the "
        "projection rests on the mechanistic model alone.",
    )


def _voi(criteria: dict[str, dict[str, Any]], sensitivity: dict[str, Any]) -> list[str]:
    """Value-of-information: the highest-leverage next measurements."""
    notes: list[str] = []
    if criteria["coverage"]["status"] == "unknown":
        notes.append("Measure target binding affinity (Ki/Kd) to establish target coverage.")
    if criteria["safety"]["status"] in {"unknown", "fail", "caution"}:
        notes.append(
            "Obtain an in-vivo NOAEL (dose-range-finding study) to anchor the safety margin."
        )
    if criteria["domain"]["status"] == "caution":
        notes.append(
            "Measure species-specific hepatocyte intrinsic clearance; human-trained ML clearance is "
            "not predictive across species."
        )
    if sensitivity.get("available") and sensitivity.get("dominant_driver"):
        notes.append(
            f"The exposure prediction is most sensitive to '{sensitivity['dominant_driver']}'; a "
            "direct measurement of it would most tighten the projection."
        )
    return notes


def stage_gate(
    *,
    arm_results: list[dict[str, Any]],
    pkpd: dict[str, Any],
    safety: dict[str, Any],
    evidence: dict[str, Any],
    sensitivity: dict[str, Any],
) -> dict[str, Any]:
    """Combine criteria into GO / NO-GO / CONDITIONAL with full rationale."""
    criteria = {
        "domain": _domain_criterion(arm_results),
        "coverage": _coverage_criterion(pkpd),
        "safety": _safety_criterion(safety),
        "evidence": _evidence_criterion(evidence),
    }

    statuses = {k: v["status"] for k, v in criteria.items()}

    # Decision logic (explicit, auditable):
    if statuses["domain"] == "fail":
        recommendation = "NO-GO"
        headline = (
            "No defensible exposure could be projected; the study cannot proceed as designed."
        )
    elif statuses["coverage"] == "fail" or statuses["safety"] == "fail":
        recommendation = "NO-GO"
        headline = (
            "A hard criterion failed (target engagement or safety margin) at the simulated doses."
        )
    elif (
        "unknown" in statuses.values()
        or statuses["domain"] == "caution"
        or statuses["safety"] == "caution"
    ):
        recommendation = "CONDITIONAL"
        headline = "Proceed only after resolving the flagged gaps; the current evidence is incomplete for a firm GO."
    else:
        recommendation = "GO"
        headline = (
            "Exposure, target engagement, safety margin, and public evidence all support advancing."
        )

    return {
        "recommendation": recommendation,
        "headline": headline,
        "criteria": criteria,
        "thresholds": THRESHOLDS,
        "value_of_information": _voi(criteria, sensitivity),
        "model": "Transparent criterion-weighted stage gate (belief/plausibility posture)",
        "provenance": "derived",
        "limitations": (
            "A rule-based synthesis of the criteria above; it advises, it does not replace a study "
            "director's judgement. 'unknown' criteria weaken the recommendation toward CONDITIONAL "
            "rather than being silently treated as passes."
        ),
    }


__all__ = ["THRESHOLDS", "stage_gate"]
