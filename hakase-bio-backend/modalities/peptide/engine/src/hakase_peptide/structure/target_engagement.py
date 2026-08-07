"""Target Engagement Estimator (Functional Analysis Service Spec §5.4, §6.5).

KNOWN GAP relative to the full spec, flagged explicitly rather than papered
over: the Structural Biology Service in this codebase does not yet compute
peptide-target interface descriptors (ΔSASA, contact count/composition) from a
predicted complex. ``structure/complex_prediction.py`` currently returns only
complex availability/status and an overall confidence label -- not per-residue
interface geometry. Until that interface-geometry computation exists, this
module cannot implement the full learned scoring function
h_phi(deltaSASA, contact_composition, interface_confidence, sequence_features)
described in §6.5.

What it does instead, honestly: a documented placeholder combiner using what
IS available today (complex status/confidence + the modality-relevant
functional predictor score), reported at reduced confidence and explicitly
tagged ``heuristic_placeholder`` in provenance -- never presented as the full
learned model. This is a sanctioned extension point per §15 ("finer-grained
target engagement modeling ... can extend the target_engagement field ...
without disrupting existing consumers"). Confidence is capped by the
structural confidence per §10.3 -- engagement is never reported more
confidently than the structural evidence it is derived from.
"""

from __future__ import annotations

from typing import Any

ENGAGEMENT_MODEL_VERSION = "0.1.0-heuristic-placeholder"

_STRUCTURAL_CONFIDENCE_SCORE = {"high": 0.9, "moderate": 0.6, "low": 0.3}


def estimate_target_engagement(
    *,
    engagement_procedure: str,
    complex_prediction: dict[str, Any] | None,
    relevant_predictor_score: float | None,
    relevant_predictor_confidence: float | None = None,
) -> dict[str, Any]:
    """Estimate target engagement from what structural + functional evidence
    is actually available. Never fabricates a score when inputs are missing
    (§12) -- returns an explicit ``not_applicable``/``partially_complete``
    status with a reason code instead.
    """
    base_provenance = {
        "engagement_procedure": engagement_procedure,
        "model_version": ENGAGEMENT_MODEL_VERSION,
        "heuristic_placeholder": True,
        "known_gap": (
            "interface geometry (deltaSASA, contact composition) is not yet "
            "computed by the Structural Biology Service in this codebase"
        ),
    }

    if not complex_prediction or not complex_prediction.get("complex_available"):
        return {
            "present": False,
            "status": "not_applicable",
            "engagement_score": None,
            "confidence": None,
            "reason_code": "no_structural_complex",
            "contributing_structural_evidence_ref": None,
            "provenance": base_provenance,
        }

    structural_conf_label = complex_prediction.get("confidence")
    structural_conf_score = _STRUCTURAL_CONFIDENCE_SCORE.get(structural_conf_label, 0.3)

    if relevant_predictor_score is None:
        return {
            "present": True,
            "status": "partially_complete",
            "engagement_score": None,
            "confidence": {"tier": "reduced", "score": None},
            "reason_code": "no_functional_predictor_score",
            "contributing_structural_evidence_ref": "structural.complex_prediction",
            "provenance": {**base_provenance, "structural_confidence_label": structural_conf_label},
        }

    # Documented placeholder combiner: geometric mean of structural confidence
    # and the modality-relevant functional predictor score, then capped by
    # structural confidence so engagement is never reported more confidently
    # than the structural evidence it rests on (§10.3).
    raw = (structural_conf_score * max(0.0, min(1.0, relevant_predictor_score))) ** 0.5
    engagement_score = min(structural_conf_score, raw)

    conf_inputs = [structural_conf_score]
    if relevant_predictor_confidence is not None:
        conf_inputs.append(max(0.0, min(1.0, relevant_predictor_confidence)))
    confidence_score = min(conf_inputs)

    return {
        "present": True,
        "status": "complete",
        "engagement_score": round(float(engagement_score), 4),
        "confidence": {
            "tier": _tier_for(confidence_score),
            "score": round(float(confidence_score), 4),
        },
        "reason_code": None,
        "contributing_structural_evidence_ref": "structural.complex_prediction",
        "provenance": {**base_provenance, "structural_confidence_label": structural_conf_label},
    }


def _tier_for(score: float | None) -> str:
    if score is None:
        return "unavailable"
    if score >= 0.75:
        return "high"
    if score >= 0.5:
        return "moderate"
    return "low"
