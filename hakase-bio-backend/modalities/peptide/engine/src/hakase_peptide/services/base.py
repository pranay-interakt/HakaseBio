"""Common Scientific Service contract (doc 01 §5.3).

Every service exposes ``name``, ``evidence_type``, ``depends_on`` and a
``run(context) -> EvidenceObject``. Base helpers assemble a fully-populated
Evidence Object so individual services focus on science, not plumbing.
"""

from __future__ import annotations

import abc
from typing import Any

from ..domain.evidence import (
    ApplicabilityDomain,
    Confidence,
    EvidenceObject,
    EvidenceTier,
    EvidenceType,
    Provenance,
    Uncertainty,
    ValidationStatus,
)
from ..domain.peptide import Peptide
from ..infrastructure.orchestrator import ExecutionContext


class ScientificService(abc.ABC):
    name: str
    evidence_type: EvidenceType
    depends_on: list[EvidenceType] = []

    @abc.abstractmethod
    def run(self, context: ExecutionContext) -> EvidenceObject: ...

    # ---- helpers ------------------------------------------------------------
    def _evidence(
        self,
        context: ExecutionContext,
        *,
        payload: dict[str, Any],
        confidence: Confidence,
        uncertainty: Uncertainty,
        applicability: ApplicabilityDomain,
        provenance: Provenance,
        tier: EvidenceTier,
        validation_status: ValidationStatus = ValidationStatus.INTERNALLY_VALIDATED,
        metadata: dict[str, Any] | None = None,
        limitations: list[str] | None = None,
        warnings: list[str] | None = None,
    ) -> EvidenceObject:
        meta = {
            "platform_version": "3.0.0",
            "service": self.name,
            "structure_provider": context.config.structure_provider,
            "embedding_provider": context.config.embedding_provider,
        }
        meta.update(metadata or {})
        return EvidenceObject(
            evidence_type=self.evidence_type,
            producing_service=self.name,
            subject_id=context.peptide.subject_id,
            execution_id=context.execution_id,
            scientific_payload=payload,
            confidence=confidence,
            uncertainty=uncertainty,
            applicability_domain=applicability,
            validation_status=validation_status,
            provenance=provenance,
            evidence_tier=tier,
            metadata=meta,
            limitations=limitations or [],
            warnings=warnings or [],
        )

    @staticmethod
    def _length_applicability(
        peptide: Peptide,
        *,
        min_len: int,
        max_len: int,
        modality: str | None = None,
        notes: str = "",
    ) -> ApplicabilityDomain:
        in_domain = min_len <= peptide.length <= max_len
        extrapolation = not in_domain
        note = notes
        if extrapolation:
            note = (note + " " if note else "") + (
                f"Length {peptide.length} outside validated range [{min_len}, {max_len}]."
            )
        return ApplicabilityDomain(
            in_domain=in_domain,
            supported_length_range=[min_len, max_len],
            modality_support=modality,
            extrapolation_flag=extrapolation,
            notes=note.strip(),
        )
