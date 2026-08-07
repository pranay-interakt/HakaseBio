"""
Platform Evidence Object.

Source:
  - 04_Evidence_Framework_Specification.md, "Platform Evidence Object" (§3)
  - 02_Scientific_Workflow_Specification.md, Stage 6 (Evidence Aggregation)
  - 05_Decision_and_Reasoning_Framework_Specification.md, §3, §8

This is the sole input to the Decision & Reasoning Framework (doc 05). It is
immutable once constructed (Evidence Framework §3: "The Platform Evidence
Object is immutable and becomes the sole input to the Decision Engine.").

=====================================================================
ASSUMPTIONS / OPEN GAPS -- FLAG FOR SCIENTIFIC/ENGINEERING REVIEW
=====================================================================
1. Missing Evidence Handling (Decision & Reasoning Framework §8) states
   evidence may be absent (e.g. failed/skipped service) and must be treated
   as "unknown, not negative." Each of the five per-service fields below is
   therefore Optional, paired with an explicit `EvidenceAvailability` status
   -- this pairing is an implementation choice made here, not specified in
   the source documents.

2. `aggregated_confidence` / `aggregated_uncertainty` are mandated fields
   (Evidence Framework §3) but NO aggregation formula is specified anywhere
   in docs 02-05. The fields are modeled as plain floats; the function that
   computes them from the five per-service confidence_summary/uncertainty
   blocks must be defined by whoever implements the Decision Engine
   (Recommended Engineering Stack, doc 14, "Decision Engine: Custom Python
   Rules"). Do NOT treat the presence of this field as evidence that the
   math has already been decided.

3. `conflict_summary` is a mandated field (Evidence Framework §3) and
   Decision & Reasoning Framework §6 lists categories of conflict (e.g.
   "structural predictions inconsistent with predicted biological
   function") but does not give a machine-checkable rule for detecting
   them. `ConflictEntry` below is a reasonable generic shape (which
   evidence sources conflict, a severity, a free-text description) that
   should be reviewed against actual conflict-detection logic once written.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .developability import DevelopabilityEvidence
from .functional import FunctionalEvidence
from .physicochemical import PhysicochemicalEvidence
from .safety import SafetyEvidence
from .structural import StructuralEvidence


def _utcnow() -> datetime:
    return datetime.now(UTC)


class EvidenceAvailability(str, Enum):
    """See module docstring ASSUMPTION 1."""

    AVAILABLE = "available"
    FAILED = "failed"
    SKIPPED = "skipped"
    NOT_REQUESTED = "not_requested"


class ConflictSeverity(str, Enum):
    MINOR = "minor"
    MODERATE = "moderate"
    CRITICAL = "critical"


class ConflictEntry(BaseModel):
    """See module docstring ASSUMPTION 3."""

    model_config = ConfigDict(extra="forbid")

    conflicting_sources: list[
        Literal["physicochemical", "structural", "functional", "developability", "safety"]
    ]
    severity: ConflictSeverity
    description: str = Field(
        description="Human-readable description, e.g. 'Functional Analysis "
        "predicts strong membrane-disruptive activity; Safety Service flags "
        "high hemolysis risk (0.82) for the same peptide.'"
    )
    resolved: bool = False


class ConsistencyAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agreement_score: float = Field(ge=0.0, le=1.0, description="See module docstring ASSUMPTION 2.")
    services_in_agreement: list[str] = Field(default_factory=list)
    services_in_conflict: list[str] = Field(default_factory=list)


class PlatformEvidenceObject(BaseModel):
    """The complete computational state of a peptide candidate. Immutable
    once constructed; corrections generate a new object linked through
    provenance (Domain Model Spec §3.4, §3.7)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    platform_evidence_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    job_id: uuid.UUID
    execution_id: uuid.UUID
    peptide_id: uuid.UUID
    target_id: uuid.UUID | None = None
    created_at: datetime = Field(default_factory=_utcnow)

    # --- Per-service evidence -------------------------------------------
    physicochemical: PhysicochemicalEvidence | None = None
    physicochemical_availability: EvidenceAvailability = EvidenceAvailability.AVAILABLE

    structural: StructuralEvidence | None = None
    structural_availability: EvidenceAvailability = EvidenceAvailability.AVAILABLE

    functional: FunctionalEvidence | None = None
    functional_availability: EvidenceAvailability = EvidenceAvailability.AVAILABLE

    developability: DevelopabilityEvidence | None = None
    developability_availability: EvidenceAvailability = EvidenceAvailability.AVAILABLE

    safety: SafetyEvidence | None = None
    safety_availability: EvidenceAvailability = EvidenceAvailability.AVAILABLE

    # --- Aggregation (Evidence Framework §3) -----------------------------
    aggregated_confidence: float = Field(ge=0.0, le=1.0)
    aggregated_uncertainty: float = Field(ge=0.0, le=1.0)
    consistency_assessment: ConsistencyAssessment
    conflict_summary: list[ConflictEntry] = Field(default_factory=list)

    def missing_services(self) -> list[str]:
        """Convenience helper -- NOT part of the source spec, just useful
        for Decision Engine implementers per Decision & Reasoning Framework
        §8 (Missing Evidence Handling)."""
        pairs = [
            ("physicochemical", self.physicochemical_availability),
            ("structural", self.structural_availability),
            ("functional", self.functional_availability),
            ("developability", self.developability_availability),
            ("safety", self.safety_availability),
        ]
        return [name for name, status in pairs if status != EvidenceAvailability.AVAILABLE]
