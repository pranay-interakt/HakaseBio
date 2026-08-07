"""Immutable Decision Record (doc 05 ch.15 & ch.17).

Captures the complete, replayable basis for a recommendation: the resolved
policy (and why it was chosen), every domain score with its contributing
variables, hard-constraint evaluations, consistency conflicts, aggregated
confidence, the decision and its rationale, experimental recommendations, and a
backward evidence trace to every originating Evidence Object.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from ..domain.ids import new_id, utc_now_iso


class Decision(str, Enum):
    GO = "GO"
    CONDITIONAL_GO = "CONDITIONAL_GO"
    NO_GO = "NO_GO"


@dataclass(frozen=True)
class DecisionRecord:
    subject_id: str
    execution_id: str
    decision: Decision
    forced_by_hard_constraint: bool
    platform_score: float | None
    decision_confidence: float | None
    scientific_readiness: float | None
    policy: dict[str, Any]
    resolved_by: str
    domain_scores: dict[str, float | None]
    domain_detail: dict[str, Any]
    hard_constraint_evaluations: list[dict[str, Any]]
    consistency: dict[str, Any]
    completeness: dict[str, Any]
    aggregated_confidence: float | None
    aggregated_uncertainty: float | None
    rationale: str
    recommendations: list[str]
    evidence_trace: list[dict[str, Any]]
    warnings: list[str] = field(default_factory=list)

    decision_id: str = field(default_factory=lambda: new_id("decision"))
    timestamp: str = field(default_factory=utc_now_iso)

    def to_dict(self) -> dict[str, Any]:
        return {
            "decision_id": self.decision_id,
            "timestamp": self.timestamp,
            "subject_id": self.subject_id,
            "execution_id": self.execution_id,
            "decision": self.decision.value,
            "forced_by_hard_constraint": self.forced_by_hard_constraint,
            "platform_score": self.platform_score,
            "decision_confidence": self.decision_confidence,
            "scientific_readiness": self.scientific_readiness,
            "policy": self.policy,
            "resolved_by": self.resolved_by,
            "domain_scores": self.domain_scores,
            "domain_detail": self.domain_detail,
            "hard_constraint_evaluations": self.hard_constraint_evaluations,
            "consistency": self.consistency,
            "completeness": self.completeness,
            "aggregated_confidence": self.aggregated_confidence,
            "aggregated_uncertainty": self.aggregated_uncertainty,
            "rationale": self.rationale,
            "recommendations": self.recommendations,
            "evidence_trace": self.evidence_trace,
            "warnings": self.warnings,
        }
