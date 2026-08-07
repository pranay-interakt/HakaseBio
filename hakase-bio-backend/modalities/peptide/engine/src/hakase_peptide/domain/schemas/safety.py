"""
Safety Evidence Object.

Source: 11_Safety_Service_Specification.md, Section 14.
"""

from __future__ import annotations

import uuid
from typing import ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field

from .common import EvidenceObjectBase, FieldConfidence, ProvenanceBase

SafetyModule = Literal[
    "immunogenicity_prediction",
    "toxicity_prediction",
    "off_target_assessment",
    "safety_validation",
    "evidence_generator",
]

DomainStatus = Literal["in_domain", "borderline", "out_of_domain"]


class SafetyProvenance(ProvenanceBase):
    originating_modules: list[SafetyModule] = Field(default_factory=list)
    model_identifier_and_version: dict[str, str] = Field(
        default_factory=dict,
        description="e.g. {'NetMHCpan': 'v4.1', 'ToxinPred2': 'v2.0', "
        "'HemoPI': 'v1.0', 'AllerTOP': 'v2.0'} per §14.",
    )
    reference_databases_used: list[str] = Field(
        default_factory=list, description="e.g. ['IEDB', 'UniProt', 'ChEMBL']."
    )


class MhcBindingEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    peptide_fragment: str
    hla_allele: str
    binding_score: float
    percentile_rank: float | None = None


class PredictedEpitope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fragment: str
    start_index: int = Field(ge=0)
    end_index: int = Field(ge=0)
    score: float
    confidence: FieldConfidence


class ImmunogenicityAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mhc_binding_profile: list[MhcBindingEntry] = Field(default_factory=list)
    mhc_binding_confidence: FieldConfidence
    predicted_epitopes: list[PredictedEpitope] = Field(default_factory=list)
    structural_refinement_applied: bool = False
    structural_confidence_used: FieldConfidence | None = Field(
        default=None,
        description="Only present if structural_refinement_applied is True.",
    )


class ToxicityAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    general_toxicity: float = Field(ge=0.0, le=1.0)
    general_toxicity_confidence: FieldConfidence
    hemolysis_risk: float = Field(ge=0.0, le=1.0)
    hemolysis_risk_confidence: FieldConfidence
    allergenicity_risk: float = Field(ge=0.0, le=1.0)
    allergenicity_risk_confidence: FieldConfidence


class OffTargetMatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    match_id: str
    similarity_score: float = Field(ge=0.0, le=1.0)
    source_database: str


class OffTargetAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    on_target_baseline_reference: uuid.UUID | None = Field(
        default=None, description="Reference to Functional Evidence used, per §14."
    )
    flagged_off_target_matches: list[OffTargetMatch] = Field(default_factory=list)
    flagged_off_target_confidence: FieldConfidence
    on_target_exclusion_applied: bool = False


class SafetyValidation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    applicability_domain_flags: dict[str, DomainStatus] = Field(
        default_factory=dict,
        description="liability_class -> domain status, e.g. "
        "{'hemolysis': 'in_domain', 'allergenicity': 'borderline'}.",
    )
    coverage_gaps: list[str] = Field(
        default_factory=list,
        description="Liability classes for which no confident prediction "
        "could be made, per §14.",
    )


class SafetyConfidenceSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    immunogenicity_tier: FieldConfidence
    toxicity_tier: FieldConfidence
    off_target_tier: FieldConfidence
    aggregate_note: str | None = None


class SafetyEvidence(EvidenceObjectBase):
    """Safety Evidence Object -- Safety Service Spec §14. Final Scientific
    Service in the pipeline (Scientific Workflow Spec, Stage 5)."""

    EVIDENCE_TYPE: ClassVar[str] = "safety"
    PRODUCING_SERVICE: ClassVar[str] = "safety-service"

    peptide_object_reference: uuid.UUID
    immunogenicity_assessment: ImmunogenicityAssessment
    toxicity_assessment: ToxicityAssessment
    off_target_assessment: OffTargetAssessment
    safety_validation: SafetyValidation
    provenance: SafetyProvenance
    confidence_summary: SafetyConfidenceSummary
