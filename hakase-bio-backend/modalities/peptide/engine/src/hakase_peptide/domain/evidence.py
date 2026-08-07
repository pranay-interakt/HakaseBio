"""The Evidence Object — the canonical evidence contract (doc 04).

Every Scientific Service publishes exactly one immutable Evidence Object. The
object separates the raw scientific payload from its confidence, uncertainty,
applicability domain, validation status, provenance and metadata, so that the
Decision Layer can reason over standardized evidence without touching models.

Immutability (doc 03 §3.4, doc 04 §13): Evidence Objects are frozen. A
correction is a *new* object linked through provenance, never an in-place edit.

Architectural Note:
This dataclass-based implementation provides a lightweight execution contract.
It aligns conceptually with the Pydantic schemas defined in the architecture
repository (bh-yeshwanth/hakaseai-architecture, Docs/Evidence Object Schemas/)
but retains a generic `scientific_payload` dictionary to ensure scientific
services can evolve their descriptor payloads without breaking code dependencies.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any

from .. import EVIDENCE_SCHEMA_VERSION
from .ids import new_id, sha256_hex, utc_now_iso


class EvidenceType(str, Enum):
    PHYSICOCHEMICAL = "physicochemical"
    STRUCTURAL = "structural"
    FUNCTIONAL = "functional"
    DEVELOPABILITY = "developability"
    SAFETY = "safety"


class ConfidenceCategory(str, Enum):
    HIGH = "high"
    MODERATE = "moderate"
    LOW = "low"
    NONE = "none"


class ValidationStatus(str, Enum):
    NOT_VALIDATED = "not_validated"
    INTERNALLY_VALIDATED = "internally_validated"
    CROSS_SERVICE_CONSISTENT = "cross_service_consistent"
    EXPERIMENTALLY_SUPPORTED = "experimentally_supported"
    DEPRECATED = "deprecated"
    UNAVAILABLE = "unavailable"


class EvidenceTier(str, Enum):
    """How strong the *kind* of evidence is, independent of its numeric value.

    Deterministic first-principles calculations are the strongest tier;
    ML predictions and homology/similarity are progressively weaker (doc 04 §7,
    doc 05 variable taxonomy).
    """

    DETERMINISTIC = "deterministic"  # exact biochemistry / physics
    STRUCTURE_MODEL = "structure_model"  # folding / docking models
    ML_MODEL = "ml_model"  # trained statistical models
    SIMILARITY = "similarity"  # homology / nearest-neighbour
    HEURISTIC = "heuristic"  # rule-based estimate


def _category_from_score(score: float | None) -> ConfidenceCategory:
    if score is None:
        return ConfidenceCategory.NONE
    if score >= 0.75:
        return ConfidenceCategory.HIGH
    if score >= 0.5:
        return ConfidenceCategory.MODERATE
    if score > 0.0:
        return ConfidenceCategory.LOW
    return ConfidenceCategory.NONE


@dataclass(frozen=True)
class Confidence:
    """Confidence is reported *separately* from the prediction (doc 04 §7)."""

    score: float | None  # [0, 1] or None when N/A
    category: ConfidenceCategory
    calibration_method: str
    supporting_evidence_count: int = 0
    rationale: str = ""

    @classmethod
    def make(
        cls,
        score: float | None,
        calibration_method: str,
        *,
        supporting_evidence_count: int = 0,
        rationale: str = "",
    ) -> Confidence:
        if score is not None:
            if not math.isfinite(score):
                raise ValueError("Confidence score must be finite.")
            score = max(0.0, min(1.0, float(score)))
        return cls(
            score=score,
            category=_category_from_score(score),
            calibration_method=calibration_method,
            supporting_evidence_count=supporting_evidence_count,
            rationale=rationale,
        )

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["category"] = self.category.value
        return d


@dataclass(frozen=True)
class Uncertainty:
    """Uncertainty is propagated, never collapsed into one number (doc 04 §8)."""

    model_uncertainty: float | None = None  # e.g. 1 - CV AUC, or std
    inherited_uncertainty: float | None = None  # from upstream evidence
    numerical_uncertainty: float | None = None  # rounding / discretisation
    ensemble_variance: float | None = None
    sources: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ApplicabilityDomain:
    """Whether the input lies within the validated domain (doc 04 §9)."""

    in_domain: bool
    supported_length_range: list[int] | None = None  # [min, max]
    supported_residue_types: str = "standard_20"
    modification_support: str = "linear_and_disulfide"
    modality_support: str | None = None
    training_distribution_similarity: float | None = None  # [0,1] if known
    extrapolation_flag: bool = False
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class Provenance:
    """Full computational lineage — forms a DAG across evidence (doc 04 §6)."""

    originating_service: str
    algorithms: list[str] = field(default_factory=list)
    upstream_evidence_ids: list[str] = field(default_factory=list)
    model_checkpoints: list[str] = field(default_factory=list)
    parameters: dict[str, Any] = field(default_factory=dict)
    external_databases: list[str] = field(default_factory=list)
    references: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class EvidenceObject:
    """One immutable unit of scientific evidence.

    Contains every mandatory field required by doc 04 §4. Never mutate — create
    a new object and link it via ``provenance.upstream_evidence_ids``.
    """

    evidence_type: EvidenceType
    producing_service: str
    subject_id: str
    execution_id: str
    scientific_payload: dict[str, Any]
    confidence: Confidence
    uncertainty: Uncertainty
    applicability_domain: ApplicabilityDomain
    validation_status: ValidationStatus
    provenance: Provenance
    evidence_tier: EvidenceTier
    metadata: dict[str, Any] = field(default_factory=dict)
    limitations: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    evidence_id: str = field(default_factory=lambda: new_id("evidence"))
    schema_version: str = EVIDENCE_SCHEMA_VERSION
    timestamp: str = field(default_factory=utc_now_iso)

    # ---- integrity ----------------------------------------------------------
    @property
    def is_available(self) -> bool:
        return self.validation_status is not ValidationStatus.UNAVAILABLE

    @property
    def payload_checksum(self) -> str:
        return sha256_hex(self.scientific_payload)

    def to_dict(self) -> dict[str, Any]:
        d = {
            "evidence_id": self.evidence_id,
            "evidence_type": self.evidence_type.value,
            "schema_version": self.schema_version,
            "producing_service": self.producing_service,
            "subject_id": self.subject_id,
            "execution_id": self.execution_id,
            "timestamp": self.timestamp,
            "evidence_tier": self.evidence_tier.value,
            "scientific_payload": self.scientific_payload,
            "payload_checksum": self.payload_checksum,
            "confidence": self.confidence.to_dict(),
            "uncertainty": self.uncertainty.to_dict(),
            "applicability_domain": self.applicability_domain.to_dict(),
            "validation_status": self.validation_status.value,
            "provenance": self.provenance.to_dict(),
            "metadata": self.metadata,
            "limitations": list(self.limitations),
            "warnings": list(self.warnings),
        }
        return d


def unavailable_evidence(
    *,
    evidence_type: EvidenceType,
    producing_service: str,
    subject_id: str,
    execution_id: str,
    reason_code: str,
    reason_detail: str,
    provenance: Provenance,
    metadata: dict[str, Any] | None = None,
) -> EvidenceObject:
    """Structured "could not compute" evidence — the *only* sanctioned response
    when a predictor cannot run. Never a fabricated number (doc 01 §1.6, project
    honesty policy). Carries a machine-readable ``reason_code``.
    """
    return EvidenceObject(
        evidence_type=evidence_type,
        producing_service=producing_service,
        subject_id=subject_id,
        execution_id=execution_id,
        scientific_payload={
            "status": "unavailable",
            "reason_code": reason_code,
            "reason_detail": reason_detail,
        },
        confidence=Confidence.make(
            None, "not_applicable", rationale="Evidence could not be computed."
        ),
        uncertainty=Uncertainty(sources=["evidence_unavailable"]),
        applicability_domain=ApplicabilityDomain(in_domain=False, notes=reason_detail),
        validation_status=ValidationStatus.UNAVAILABLE,
        provenance=provenance,
        evidence_tier=EvidenceTier.DETERMINISTIC,
        metadata=metadata or {},
        limitations=["No value produced; downstream scoring must treat as missing."],
        warnings=[f"{producing_service} unavailable: {reason_code}"],
    )
