"""Typed §14 evidence-payload schemas (Pydantic).

These validate the *scientific_payload* blocks that Scientific Services attach
to the generic dataclass ``EvidenceObject`` (``domain/evidence.py``). They are a
validation layer, not a replacement for the execution-contract dataclass: the
service builds a plain dict, validates it against the model here, and stores the
validated dict on the evidence object. This is the "keep the generic payload +
validate against the typed schema" reconciliation (see the physicochemical
implementation roadmap, decision #1).

Ported/adapted from the architecture repository's
``Docs/Evidence Object Schemas/`` (physicochemical.py + the common.py primitives
it needs), trimmed to the primitives each in-backend payload actually uses.
"""

from .physicochemical import (
    ChargeDistributionModel,
    CompositionalStatisticsModel,
    ConfidenceTier,
    DescriptorsModel,
    EmbeddingsModel,
    EmbeddingVectorModel,
    FieldConfidence,
    HydrophobicityProfileModel,
    HydrophobicMomentModel,
    InstabilityIndexModel,
    NetChargeByPhModel,
    PhysicochemicalConfidenceSummary,
    PhysicochemicalProvenanceModel,
    PhysicochemicalTypedPayload,
    ValueConfidence,
)

__all__ = [
    "ChargeDistributionModel",
    "CompositionalStatisticsModel",
    "ConfidenceTier",
    "DescriptorsModel",
    "EmbeddingVectorModel",
    "EmbeddingsModel",
    "FieldConfidence",
    "HydrophobicityProfileModel",
    "HydrophobicMomentModel",
    "InstabilityIndexModel",
    "NetChargeByPhModel",
    "PhysicochemicalConfidenceSummary",
    "PhysicochemicalProvenanceModel",
    "PhysicochemicalTypedPayload",
    "ValueConfidence",
]
