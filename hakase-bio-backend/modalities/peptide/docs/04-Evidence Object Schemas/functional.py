"""
Functional Evidence Object.

Source: 09_Functional_Analysis_Service_Specification.md, Section 14.
"""

from __future__ import annotations

import uuid
from typing import ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field

from .common import EvidenceObjectBase, FieldConfidence, ProvenanceBase

FunctionalModule = Literal[
    "workflow_selector",
    "similarity_engine",
    "functional_predictors",
    "target_engagement_estimator",
    "consistency_validator",
    "evidence_generator",
]


class FunctionalProvenance(ProvenanceBase):
    originating_modules: list[FunctionalModule] = Field(default_factory=list)
    model_identifier_and_version: dict[str, str] = Field(
        default_factory=dict,
        description="predictor_name -> version, e.g. {'ESM-2': 'v2024.1', "
        "'XGBoost-activity-clf': 'v3.2'} per §14.",
    )
    reference_databases_used: list[str] = Field(
        default_factory=list,
        description="e.g. ['DBAASP', 'APD3', 'SATPdb', 'PeptideAtlas', 'ChEMBL'].",
    )


class EmbeddingMatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    match_id: str = Field(description="Identifier of the matched peptide/entry.")
    similarity_score: float = Field(ge=0.0, le=1.0)
    source_database: str


class AlignmentMatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    match_id: str
    alignment_score: float
    percent_identity: float | None = Field(default=None, ge=0.0, le=100.0)
    source_database: str


class SimilarityAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    embedding_based_matches: list[EmbeddingMatch] = Field(default_factory=list)
    embedding_match_confidence: FieldConfidence
    alignment_based_matches: list[AlignmentMatch] = Field(default_factory=list)
    alignment_match_confidence: FieldConfidence


class PredictorScore(BaseModel):
    """One named endpoint's predicted score (e.g. 'antimicrobial_activity',
    'cell_penetration')."""

    model_config = ConfigDict(extra="forbid")

    endpoint: str
    value: float
    model_identifier_and_version: str
    confidence: FieldConfidence


class FunctionalPredictions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    structured_model_scores: list[PredictorScore] = Field(default_factory=list)
    embedding_model_scores: list[PredictorScore] = Field(default_factory=list)


class TargetEngagement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    present: bool
    engagement_score: float | None = Field(default=None, ge=0.0, le=1.0)
    confidence: FieldConfidence | None = None
    contributing_structural_evidence_ref: uuid.UUID | None = Field(
        default=None,
        description="Reference to the Structural Evidence Object (or specific "
        "field within it) used to derive this score, per §14 traceability.",
    )


class ConsistencyAssessment(BaseModel):
    """Cross-checks predictions from similarity search, structured models,
    and embedding models against each other."""

    model_config = ConfigDict(extra="forbid")

    agreement_score: float = Field(ge=0.0, le=1.0)
    conflict_flags: list[str] = Field(
        default_factory=list,
        description="Specific conflicting predictions, if any, e.g. "
        "'embedding_model_scores.antimicrobial_activity disagrees with "
        "alignment_based_matches.DBAASP:1234 (delta=0.41)'.",
    )


class FunctionalConfidenceSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    similarity_tier: FieldConfidence
    model_tier: FieldConfidence
    engagement_tier: FieldConfidence | None = None
    aggregate_note: str | None = None


class FunctionalEvidence(EvidenceObjectBase):
    """Functional Evidence Object -- Functional Analysis Service Spec §14.
    Published per peptide, or per peptide-target pair where applicable."""

    EVIDENCE_TYPE: ClassVar[str] = "functional"
    PRODUCING_SERVICE: ClassVar[str] = "functional-analysis-service"

    peptide_object_reference: uuid.UUID
    modality: str = Field(description="Declared or inferred therapeutic modality.")
    target_reference: uuid.UUID | None = None
    similarity_analysis: SimilarityAnalysis
    functional_predictions: FunctionalPredictions
    target_engagement: TargetEngagement
    consistency_assessment: ConsistencyAssessment
    provenance: FunctionalProvenance
    confidence_summary: FunctionalConfidenceSummary
