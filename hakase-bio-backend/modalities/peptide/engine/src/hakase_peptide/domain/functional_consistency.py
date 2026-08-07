"""Consistency Validator (Functional Analysis Service Spec §5.5, §6.6).

Compares independent functional estimates (structured predictor, embedding
predictor, target engagement) for mutual agreement. Convergence raises
confidence in the overall Functional Evidence Object; divergence is flagged
explicitly via ``conflict_flags`` -- never silently averaged away (§12:
"Conflicting predictions ... flag explicitly, never average").

Deterministic, no ML: pairwise absolute-difference agreement over whichever
named [0,1] scores are actually available. With fewer than two independent
scores, agreement cannot be assessed at all, which is itself reported
explicitly rather than defaulting to a fabricated "consistent".
"""

from __future__ import annotations

from typing import Any

VALIDATOR_VERSION = "1.0.0"
CONFLICT_THRESHOLD = 0.35  # pairwise |delta| above this is flagged, per §6.6


def assess_consistency(scores: dict[str, float | None]) -> dict[str, Any]:
    """``scores`` e.g. ``{"structured_model": 0.8, "embedding_model": 0.75,
    "target_engagement": None}``. Only keys with a non-None value participate.
    """
    available = {k: v for k, v in scores.items() if v is not None}
    provenance = {
        "validator": "functional_consistency_validator",
        "validator_version": VALIDATOR_VERSION,
        "deterministic": True,
        "conflict_threshold": CONFLICT_THRESHOLD,
    }

    if len(available) < 2:
        return {
            "agreement_score": None,
            "conflict_flags": [],
            "status": "insufficient_independent_evidence",
            "participating_methods": list(available.keys()),
            "provenance": provenance,
        }

    keys = list(available.keys())
    deltas: list[float] = []
    conflict_flags: list[str] = []
    for i in range(len(keys)):
        for j in range(i + 1, len(keys)):
            a, b = keys[i], keys[j]
            delta = abs(available[a] - available[b])
            deltas.append(delta)
            if delta > CONFLICT_THRESHOLD:
                conflict_flags.append(f"{a} vs {b} disagree (delta={delta:.2f})")

    agreement_score = 1.0 - (sum(deltas) / len(deltas))
    agreement_score = max(0.0, min(1.0, agreement_score))

    return {
        "agreement_score": round(agreement_score, 4),
        "conflict_flags": conflict_flags,
        "status": "conflicting" if conflict_flags else "consistent",
        "participating_methods": keys,
        "provenance": provenance,
    }
