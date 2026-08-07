"""The Platform Evidence Object (doc 04 "Platform Evidence Object", doc 03).

The Decision Layer does not reason over individual Evidence Objects directly;
it first aggregates every validated Evidence Object for a subject into one
immutable Platform Evidence Object. This object is the *sole* input to the
Decision Engine and represents the complete computational state of a candidate.

Aggregation of confidence / uncertainty / consistency lives in the decision
layer (doc 04 §16 — services never aggregate across domains); this container
only assembles and freezes the collected evidence plus the decision layer's
computed aggregates.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .evidence import EvidenceObject, EvidenceType
from .ids import new_id, utc_now_iso


@dataclass(frozen=True)
class PlatformEvidence:
    subject_id: str
    execution_id: str
    evidence: dict[str, EvidenceObject]  # keyed by evidence_type value
    aggregated_confidence: float | None = None
    aggregated_uncertainty: float | None = None
    consistency_assessment: dict[str, Any] = field(default_factory=dict)
    conflict_summary: list[dict[str, Any]] = field(default_factory=list)
    completeness: dict[str, Any] = field(default_factory=dict)

    platform_evidence_id: str = field(default_factory=lambda: new_id("platform_evidence"))
    timestamp: str = field(default_factory=utc_now_iso)

    @classmethod
    def assemble(
        cls,
        subject_id: str,
        execution_id: str,
        evidence_list: list[EvidenceObject],
    ) -> PlatformEvidence:
        by_type: dict[str, EvidenceObject] = {}
        for ev in evidence_list:
            by_type[ev.evidence_type.value] = ev
        return cls(subject_id=subject_id, execution_id=execution_id, evidence=by_type)

    def get(self, evidence_type: EvidenceType) -> EvidenceObject | None:
        return self.evidence.get(evidence_type.value)

    def to_dict(self) -> dict[str, Any]:
        return {
            "platform_evidence_id": self.platform_evidence_id,
            "subject_id": self.subject_id,
            "execution_id": self.execution_id,
            "timestamp": self.timestamp,
            "evidence": {k: v.to_dict() for k, v in self.evidence.items()},
            "aggregated_confidence": self.aggregated_confidence,
            "aggregated_uncertainty": self.aggregated_uncertainty,
            "consistency_assessment": self.consistency_assessment,
            "conflict_summary": self.conflict_summary,
            "completeness": self.completeness,
        }
