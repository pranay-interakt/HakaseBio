"""Evidence Bus (doc 01 §4.8, doc 04 §15).

The sole communication channel between Scientific Services and the Decision
Layer. Services publish immutable Evidence Objects; the bus validates each
against the mandatory-field contract before acceptance and collects them per
execution. Services never exchange raw model outputs directly.
"""

from __future__ import annotations

import threading
from collections import defaultdict

from ..domain.evidence import (
    ApplicabilityDomain,
    Confidence,
    EvidenceObject,
    Provenance,
    Uncertainty,
    ValidationStatus,
)


class EvidenceSchemaError(ValueError):
    """Raised when an object does not satisfy the Evidence contract (doc 04 §4)."""


def validate_evidence(ev: EvidenceObject) -> None:
    if not isinstance(ev, EvidenceObject):
        raise EvidenceSchemaError("Only EvidenceObject instances may be published.")
    required = {
        "evidence_id": ev.evidence_id,
        "evidence_type": ev.evidence_type,
        "producing_service": ev.producing_service,
        "subject_id": ev.subject_id,
        "execution_id": ev.execution_id,
        "schema_version": ev.schema_version,
        "timestamp": ev.timestamp,
    }
    for field_name, value in required.items():
        if value in (None, ""):
            raise EvidenceSchemaError(f"Evidence missing mandatory field '{field_name}'.")
    if not isinstance(ev.scientific_payload, dict):
        raise EvidenceSchemaError("scientific_payload must be an object.")
    if not isinstance(ev.confidence, Confidence):
        raise EvidenceSchemaError("confidence must be a Confidence.")
    if not isinstance(ev.uncertainty, Uncertainty):
        raise EvidenceSchemaError("uncertainty must be an Uncertainty.")
    if not isinstance(ev.applicability_domain, ApplicabilityDomain):
        raise EvidenceSchemaError("applicability_domain must be an ApplicabilityDomain.")
    if not isinstance(ev.provenance, Provenance):
        raise EvidenceSchemaError("provenance must be a Provenance.")
    if not isinstance(ev.validation_status, ValidationStatus):
        raise EvidenceSchemaError("validation_status must be a ValidationStatus.")


class EvidenceBus:
    def __init__(self) -> None:
        self._by_exec: dict[str, list[EvidenceObject]] = defaultdict(list)
        self._lock = threading.Lock()

    def publish(self, ev: EvidenceObject) -> None:
        validate_evidence(ev)
        with self._lock:
            self._by_exec[ev.execution_id].append(ev)

    def collect(self, execution_id: str) -> list[EvidenceObject]:
        with self._lock:
            return list(self._by_exec.get(execution_id, []))

    def clear(self, execution_id: str) -> None:
        with self._lock:
            self._by_exec.pop(execution_id, None)
