"""Domain scoring, confidence aggregation and consistency (doc 05 ch.7–12).

Each participating Core Domain yields one score in [0,1] as the weighted mean of
its present, normalized soft-evidence variables. The Platform Score is the
policy-weighted mean of the domain scores, with weights renormalized over the
domains that actually produced a score (missing domains reduce completeness, not
the score's denominator arbitrarily). All numbers are traceable to named
variables and inspectable weights.
"""

from __future__ import annotations

from typing import Any

from ..domain.platform_evidence import PlatformEvidence
from .policy import Policy
from .variables import VARIABLE_REGISTRY, ExtractedVariable


def score_domains(policy: Policy, variables: dict[str, ExtractedVariable]) -> dict[str, Any]:
    domain_scores: dict[str, float | None] = {}
    domain_detail: dict[str, Any] = {}

    for domain in policy.participating_domains:
        weights = policy.variables_for_domain(domain)
        contribs: list[dict[str, Any]] = []
        num = 0.0
        den = 0.0
        for name, w in weights.items():
            ev = variables.get(name)
            present = bool(ev and ev.present and ev.normalized is not None)
            contribs.append(
                {
                    "variable": name,
                    "raw": ev.raw if ev else None,
                    "normalized": (
                        round(ev.normalized, 4) if (ev and ev.normalized is not None) else None
                    ),
                    "weight_within_domain": w,
                    "present": present,
                    "reference": VARIABLE_REGISTRY[name].reference,
                }
            )
            if present:
                num += w * ev.normalized
                den += w
        score = (num / den) if den > 0 else None
        domain_scores[domain.value] = round(score, 4) if score is not None else None
        domain_detail[domain.value] = {
            "score": domain_scores[domain.value],
            "weight_in_policy": policy.domain_weights.get(domain.value, 0.0),
            "variables": contribs,
            "scored": score is not None,
        }

    # Platform score: renormalize policy domain weights over scored domains.
    p_num = 0.0
    p_den = 0.0
    for domain in policy.participating_domains:
        s = domain_scores[domain.value]
        if s is None:
            continue
        w = policy.domain_weights.get(domain.value, 0.0)
        p_num += w * s
        p_den += w
    platform_score = round(p_num / p_den, 4) if p_den > 0 else None

    return {
        "domain_scores": domain_scores,
        "domain_detail": domain_detail,
        "platform_score": platform_score,
        "scored_weight_fraction": round(p_den, 4),
    }


def aggregate_confidence(platform_evidence: PlatformEvidence, policy: Policy) -> dict[str, Any]:
    num = 0.0
    den = 0.0
    per_domain: dict[str, float | None] = {}
    unc_vals: list[float] = []
    for domain in policy.participating_domains:
        ev = platform_evidence.get(domain)
        w = policy.domain_weights.get(domain.value, 0.0)
        if ev is None or not ev.is_available or ev.confidence.score is None:
            per_domain[domain.value] = None
            continue
        per_domain[domain.value] = ev.confidence.score
        num += w * ev.confidence.score
        den += w
        if ev.uncertainty.model_uncertainty is not None:
            unc_vals.append(ev.uncertainty.model_uncertainty)
    aggregated = round(num / den, 4) if den > 0 else None
    aggregated_unc = round(sum(unc_vals) / len(unc_vals), 4) if unc_vals else None
    return {
        "aggregated_confidence": aggregated,
        "per_domain_confidence": per_domain,
        "aggregated_uncertainty": aggregated_unc,
    }


def assess_consistency(variables: dict[str, ExtractedVariable]) -> dict[str, Any]:
    """Detect conflicting scientific signals across domains (doc 05 ch.10)."""
    conflicts: list[dict[str, Any]] = []

    def raw(name: str):
        ev = variables.get(name)
        return ev.raw if (ev and ev.present) else None

    amp = raw("amp_probability")
    hemo = raw("hemolysis_probability")
    if amp is not None and hemo is not None and float(amp) >= 0.7 and float(hemo) >= 0.7:
        conflicts.append(
            {
                "type": "therapeutic_index",
                "detail": "High predicted antimicrobial activity co-occurs with high predicted "
                "hemolysis — membrane activity may be non-selective.",
                "variables": {"amp_probability": amp, "hemolysis_probability": hemo},
                "severity": "high",
            }
        )

    camsol = raw("camsol_score")
    aggr = raw("aggregation_mean_a3v")
    if camsol is not None and aggr is not None and float(camsol) > 0.45 and float(aggr) > 0.10:
        conflicts.append(
            {
                "type": "solubility_vs_aggregation",
                "detail": "High intrinsic solubility conflicts with high aggregation propensity; "
                "review the developability evidence.",
                "variables": {"camsol_score": camsol, "aggregation_mean_a3v": aggr},
                "severity": "moderate",
            }
        )

    # Consistency score: 1.0 minus a penalty per conflict weighted by severity.
    penalty = sum(
        {"high": 0.4, "moderate": 0.2, "low": 0.1}.get(c["severity"], 0.2) for c in conflicts
    )
    consistency_score = round(max(0.0, 1.0 - penalty), 4)
    return {"conflicts": conflicts, "consistency_score": consistency_score}
