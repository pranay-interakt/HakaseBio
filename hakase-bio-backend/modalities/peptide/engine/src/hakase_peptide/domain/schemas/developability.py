"""
Developability Evidence Object.

Source: 10_Developability_Service_Specification.md, Section 14.
"""

from __future__ import annotations

import uuid
from typing import ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field

from .common import EvidenceObjectBase, FieldConfidence, ProvenanceBase

DevelopabilityModule = Literal[
    "stability_analysis",
    "aggregation_prediction",
    "manufacturability_assessment",
    "formulation_analysis",
    "evidence_generator",
]


class DevelopabilityProvenance(ProvenanceBase):
    originating_modules: list[DevelopabilityModule] = Field(default_factory=list)
    model_identifier_and_version: dict[str, str] = Field(
        default_factory=dict,
        description="e.g. {'FoldX': 'v5.1', 'Aggrescan3D': 'v2.0', "
        "'Protein-Sol': 'v1.0'} per §14.",
    )
    upstream_evidence_references: list[uuid.UUID] = Field(
        default_factory=list,
        description="Physicochemical / Structural / Functional Evidence "
        "Object ids consumed by this service, per §14.",
    )


class OxidationDeamidationLiability(BaseModel):
    model_config = ConfigDict(extra="forbid")

    residue_index: int = Field(ge=0)
    motif: str
    solvent_exposure: float | None = Field(default=None, ge=0.0, le=1.0)


class StabilityAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    folding_free_energy: float | None = Field(default=None, description="kcal/mol.")
    folding_free_energy_confidence: FieldConfidence
    contextualized_instability: float | None = None
    contextualized_instability_structural_context_used: bool = False
    contextualized_instability_confidence: FieldConfidence
    oxidation_deamidation_liabilities: list[OxidationDeamidationLiability] = Field(
        default_factory=list
    )
    oxidation_deamidation_confidence: FieldConfidence


class AggregationAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    per_residue_aggregation_profile: list[float]
    per_residue_confidence: FieldConfidence
    aggregation_prone_segments: list[tuple[int, int]] = Field(
        default_factory=list, description="List of (start, end) residue index ranges."
    )
    overall_aggregation_risk: float = Field(ge=0.0, le=1.0)
    overall_aggregation_risk_confidence: FieldConfidence


class ManufacturabilityAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    manufacturability_score: float = Field(ge=0.0, le=1.0)
    confidence: FieldConfidence
    flagged_liabilities: list[str] = Field(
        default_factory=list,
        description="Specific synthesis-chemistry concerns, e.g. "
        "'difficult coupling at residue 14 (beta-branched + hindered)'.",
    )


class FormulationCompatibility(BaseModel):
    model_config = ConfigDict(extra="forbid")

    compatible_ph_range: tuple[float, float] | None = None
    compatible_ph_range_confidence: FieldConfidence
    integrated_compatibility_note: str | None = Field(
        default=None,
        description="Synthesis of stability/aggregation/solubility findings.",
    )
    integrated_compatibility_confidence: FieldConfidence


class DevelopabilityConfidenceSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    structure_dependent_tier: FieldConfidence
    sequence_only_tier: FieldConfidence
    model_derived_tier: FieldConfidence
    aggregate_note: str | None = None


class DevelopabilityEvidence(EvidenceObjectBase):
    """Developability Evidence Object -- Developability Service Spec §14."""

    EVIDENCE_TYPE: ClassVar[str] = "developability"
    PRODUCING_SERVICE: ClassVar[str] = "developability-service"

    peptide_object_reference: uuid.UUID
    stability_assessment: StabilityAssessment
    aggregation_analysis: AggregationAnalysis
    solubility_estimate: float = Field(ge=0.0, le=1.0)
    solubility_estimate_confidence: FieldConfidence
    manufacturability_assessment: ManufacturabilityAssessment
    formulation_compatibility: FormulationCompatibility
    engineering_recommendations: list[str] = Field(
        default_factory=list,
        description="Structured, descriptive flags for potential sequence "
        "engineering, per §14 (kept as free-text strings pending a "
        "controlled vocabulary -- see docs/decision_engine notes).",
    )
    provenance: DevelopabilityProvenance
    confidence_summary: DevelopabilityConfidenceSummary
