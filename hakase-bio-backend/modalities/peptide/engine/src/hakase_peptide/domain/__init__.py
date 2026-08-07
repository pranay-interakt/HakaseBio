"""Domain model — the canonical conceptual objects of the platform (doc 03).

Every concept has exactly one canonical representation here (single source of
truth). Scientific objects (Peptide, Target, Evidence, Prediction) are kept
separate from infrastructure objects (Job) and decision objects
(PlatformEvidence, DecisionRecord).
"""

from .evidence import (
    ApplicabilityDomain,
    Confidence,
    ConfidenceCategory,
    EvidenceObject,
    EvidenceTier,
    EvidenceType,
    Provenance,
    Uncertainty,
    ValidationStatus,
    unavailable_evidence,
)
from .ids import deterministic_id, new_id, sha256_hex, utc_now_iso
from .peptide import Peptide
from .platform_evidence import PlatformEvidence
from .target import Target

__all__ = [
    "new_id",
    "deterministic_id",
    "sha256_hex",
    "utc_now_iso",
    "Peptide",
    "Target",
    "EvidenceType",
    "ConfidenceCategory",
    "ValidationStatus",
    "EvidenceTier",
    "Confidence",
    "Uncertainty",
    "ApplicabilityDomain",
    "Provenance",
    "EvidenceObject",
    "unavailable_evidence",
    "PlatformEvidence",
]
