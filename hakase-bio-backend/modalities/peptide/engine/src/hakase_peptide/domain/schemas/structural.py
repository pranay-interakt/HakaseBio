"""
Structural Evidence Object.

Source: 08_Structural_Biology_Service_Specification.md, Section 14.
"""

from __future__ import annotations

import uuid
from enum import Enum
from typing import Any, ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field

from .common import EvidenceObjectBase, FieldConfidence, ProvenanceBase

StructuralModule = Literal[
    "triage",
    "structure_prediction",
    "complex_modeling",
    "interface_analysis",
    "confidence_assessment",
    "evidence_generator",
]

InteractionType = Literal["hydrogen_bond", "electrostatic", "hydrophobic", "aromatic_stacking"]
PLDDTConfidenceCategory = Literal["very_high", "confident", "low", "very_low"]
IsolatedStructureStatus = Literal[
    "available", "unavailable", "blocked", "pending", "failed", "not_applicable"
]
PDBOutputStatus = Literal["available", "not_requested", "unavailable", "error"]
CanonicalConfidenceStatus = Literal[
    "available", "unavailable", "blocked", "pending", "failed", "not_applicable"
]
CanonicalComponentStatus = Literal[
    "available", "unavailable", "blocked", "pending", "failed", "not_applicable"
]
CanonicalConfidenceLabel = Literal[
    "very_high", "high", "moderate", "low", "very_low", "unavailable"
]
CanonicalEvidenceQuality = Literal["high", "moderate", "low", "insufficient"]
CanonicalAnalysisScope = Literal[
    "isolated_peptide",
    "isolated_peptide_with_target_context",
    "peptide_target_complex",
]
StructuralEvidenceObjectStatus = Literal[
    "available", "unavailable", "blocked", "pending", "failed", "not_applicable"
]
StructuralEvidenceValidationStatus = Literal[
    "computational_only",
    "internally_checked",
    "benchmarked",
    "experimentally_validated",
]


class StructuralFeasibilityStatus(str, Enum):
    FEASIBLE = "feasible"
    FEASIBLE_WITH_CAUTION = "feasible_with_caution"
    NOT_FEASIBLE = "not_feasible"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"


class StructuralFeasibilityDecision(str, Enum):
    PROCEED = "proceed"
    PROCEED_WITH_CAUTION = "proceed_with_caution"
    DO_NOT_PROCEED = "do_not_proceed"
    REVIEW_REQUIRED = "review_required"


class StructuralFeasibilityRiskLevel(str, Enum):
    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"
    UNKNOWN = "unknown"


class StructuralFeasibilitySeverity(str, Enum):
    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"


class StructuralFeasibilityEvidenceQuality(str, Enum):
    HIGH = "high"
    MODERATE = "moderate"
    LOW = "low"
    INSUFFICIENT = "insufficient"


class StructuralFeasibilityRuleOutcome(str, Enum):
    PASS = "pass"
    WARNING = "warning"
    FAIL = "fail"
    NOT_APPLICABLE = "not_applicable"
    UNAVAILABLE = "unavailable"


class StructuralFeasibilityReason(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    value: float | int | str | bool | None = None
    threshold: float | int | str | bool | None = None


class StructuralFeasibilityRisk(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    severity: StructuralFeasibilitySeverity
    message: str
    value: float | int | str | bool | None = None
    threshold: float | int | str | bool | None = None


class StructuralFeasibilityRecommendation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str


class StructuralFeasibilityMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mean_plddt: float | None = Field(default=None, ge=0.0, le=100.0)
    minimum_plddt: float | None = Field(default=None, ge=0.0, le=100.0)
    maximum_plddt: float | None = Field(default=None, ge=0.0, le=100.0)
    confident_residue_fraction: float | None = Field(default=None, ge=0.0, le=1.0)
    low_confidence_residue_fraction: float | None = Field(default=None, ge=0.0, le=1.0)
    low_confidence_region_count: int | None = Field(default=None, ge=0)
    n_residues: int | None = Field(default=None, ge=0)
    structure_n_residues: int | None = Field(default=None, ge=0)
    geometry_n_residues: int | None = Field(default=None, ge=0)
    confidence_n_residues: int | None = Field(default=None, ge=0)
    radius_of_gyration_angstrom: float | None = Field(default=None)
    end_to_end_distance_angstrom: float | None = Field(default=None)
    compactness_ratio: float | None = Field(default=None)
    requested_disulfide_count: int | None = Field(default=None, ge=0)
    validated_disulfide_count: int | None = Field(default=None, ge=0)
    pdb_status: str | None = None
    isolated_structure_status: str | None = None


class StructuralFeasibilityRule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rule_id: str
    outcome: StructuralFeasibilityRuleOutcome
    value: float | int | str | bool | None = None
    threshold: float | int | str | bool | None = None
    score_delta: int = 0


class StructuralFeasibilityResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: StructuralFeasibilityStatus
    decision: StructuralFeasibilityDecision
    score: int | None = Field(default=None, ge=0, le=100)
    risk_level: StructuralFeasibilityRiskLevel
    evidence_quality: StructuralFeasibilityEvidenceQuality
    reasons: list[StructuralFeasibilityReason] = Field(default_factory=list)
    risks: list[StructuralFeasibilityRisk] = Field(default_factory=list)
    recommendations: list[StructuralFeasibilityRecommendation] = Field(default_factory=list)
    metrics: StructuralFeasibilityMetrics
    rules_triggered: list[StructuralFeasibilityRule] = Field(default_factory=list)


class PerResidueConfidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    position: int = Field(ge=1, description="1-based residue position in the input sequence.")
    residue: str = Field(
        min_length=1, max_length=1, description="Input-sequence residue at position."
    )
    plddt: float = Field(
        ge=0.0,
        le=100.0,
        description="Normalized per-residue pLDDT on the 0-100 scale.",
    )
    confidence_category: PLDDTConfidenceCategory = Field(
        description=(
            "Deterministic category: very_high >=90, confident 70-<90, low 50-<70, very_low <50."
        )
    )


class LowConfidenceRegion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: int = Field(ge=1, description="1-based inclusive start position.")
    end: int = Field(ge=1, description="1-based inclusive end position.")
    length: int = Field(ge=1)
    mean_plddt: float = Field(ge=0.0, le=100.0)
    minimum_plddt: float = Field(ge=0.0, le=100.0)
    residues: str
    severity: Literal["low", "very_low"] = Field(
        description="Region severity is based on the minimum pLDDT in the region."
    )


class PerResidueConfidenceSummary(BaseModel):
    model_config = ConfigDict(extra="allow")

    total_residues: int = Field(ge=0)
    category_counts: dict[PLDDTConfidenceCategory, int] | None = None
    category_fractions: dict[PLDDTConfidenceCategory, float] | None = None
    low_confidence_residue_count: int | None = Field(default=None, ge=0)
    low_confidence_residue_fraction: float | None = Field(default=None, ge=0.0, le=1.0)
    low_confidence_region_count: int | None = Field(default=None, ge=0)
    mean_plddt: float | None = Field(default=None, ge=0.0, le=100.0)
    minimum_plddt: float | None = Field(default=None, ge=0.0, le=100.0)
    maximum_plddt: float | None = Field(default=None, ge=0.0, le=100.0)
    plddt_scale: Literal["0-100"] = Field(
        description="All per-residue pLDDT values are normalized to 0-100."
    )


class StructuralProvenance(ProvenanceBase):
    originating_modules: list[StructuralModule] = Field(default_factory=list)
    model_identifier_and_version: list[str] = Field(
        default_factory=list,
        description="e.g. ['Boltz-2:v1.4', 'AutoDock-Vina:v1.2.5'] per §14.",
    )
    reference_structures_used: list[str] = Field(
        default_factory=list, description="PDB / AlphaFold DB identifiers, if any."
    )


class StructuralClassification(BaseModel):
    """Triage result -- determines downstream structural modeling strategy."""

    model_config = ConfigDict(extra="forbid")

    triage_result: Literal["rigid", "constrained", "flexible_disordered"]
    confidence: FieldConfidence


class CoordinateSet(BaseModel):
    """A single structure or an ensemble of k samples. Coordinates themselves
    live in Object Storage (PDB/mmCIF files); this carries a reference."""

    model_config = ConfigDict(extra="forbid")

    storage_uri: str = Field(description="e.g. 's3://hakase/structures/{evidence_id}/model_1.pdb'")
    ensemble_size: int = Field(default=1, ge=1)


class IsolatedStructurePrediction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str
    model_id: str
    model_version: str
    n_residues: int = Field(ge=0)
    mean_plddt: float | None = Field(
        default=None, ge=0.0, le=100.0, description="Mean pLDDT on the 0-100 scale."
    )
    plddt_scale: Literal["0-100"] = Field(description="Normalized pLDDT output scale.")
    raw_plddt_scale: str = Field(description="Provider-reported pLDDT scale before normalization.")


class IsolatedStructureGeometry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    n_residues: int = Field(ge=0)
    mean_plddt: float | None = Field(default=None, ge=0.0, le=100.0)
    minimum_plddt: float | None = Field(default=None, ge=0.0, le=100.0)
    maximum_plddt: float | None = Field(default=None, ge=0.0, le=100.0)
    plddt_scale: Literal["0-100"] = Field(description="Normalized pLDDT output scale.")
    confident_residue_fraction: float | None = Field(
        default=None, ge=0.0, le=1.0, description="Fraction of residues with pLDDT >= 70."
    )
    radius_of_gyration_angstrom: float | None = Field(default=None, ge=0.0)
    end_to_end_distance_angstrom: float | None = Field(default=None, ge=0.0)
    compactness_ratio: float | None = Field(default=None, ge=0.0)
    disulfide_geometry: list[dict[str, object]] = Field(default_factory=list)


class IsolatedStructureConfidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    per_residue: list[PerResidueConfidence] = Field(
        default_factory=list,
        description=(
            "Per-residue normalized pLDDT records in input sequence order. "
            "Positions are 1-based and categories are very_high/confident/low/very_low."
        ),
    )
    low_confidence_regions: list[LowConfidenceRegion] = Field(
        default_factory=list, description="Contiguous 1-based ranges with pLDDT < 70."
    )
    summary: PerResidueConfidenceSummary = Field(
        description="Task 6 confidence summary; pLDDT values are normalized to 0-100."
    )


class IsolatedStructureProvenance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generator: Literal["structural_service"] | None = None
    provider: str
    model_id: str
    model_version: str
    schema_version: str | None = None
    generated_at: str | None = None
    deterministic: bool | None = None
    plddt_scale: Literal["0-100"]
    raw_plddt_scale: str | None = None


class PDBOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: PDBOutputStatus
    format: Literal["pdb"] = Field(description="Coordinate content format.")
    content: str | None = Field(
        default=None,
        description=(
            "Standard PDB text. Present only when include_pdb was requested and validated "
            "coordinate content is available; no filesystem path is returned."
        ),
    )
    content_encoding: Literal["plain_text"] | None = Field(
        default=None, description="Encoding for inline PDB content."
    )
    n_residues: int | None = Field(
        default=None, ge=0, description="Parsed peptide residue count from PDB coordinates."
    )
    provider: str | None = None
    model_id: str | None = None
    model_version: str | None = None
    byte_length: int | None = Field(default=None, ge=0)
    checksum_sha256: str | None = Field(default=None)
    reason_code: str | None = Field(default=None)
    reason_detail: str | None = Field(default=None)
    expected_n_residues: int | None = Field(default=None, ge=0)


class IsolatedStructureLimitation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    description: str


class IsolatedStructure(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: IsolatedStructureStatus
    reason_code: str | None = Field(default=None)
    reason_detail: str | None = Field(default=None)
    prediction: IsolatedStructurePrediction | None = None
    geometry: IsolatedStructureGeometry | None = Field(
        default=None,
        description="Coordinate-derived geometry; Angstrom fields use Angstrom units.",
    )
    confidence: IsolatedStructureConfidence | None = None
    pdb: PDBOutput = Field(
        description=(
            "Inline isolated-peptide PDB output status and content. Content is returned only "
            "when requested and available; internal filesystem paths are never exposed."
        )
    )
    structural_feasibility: StructuralFeasibilityResult | None = Field(default=None)
    provenance: IsolatedStructureProvenance
    limitations: list[IsolatedStructureLimitation] = Field(default_factory=list)


class ComplexPrediction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: CanonicalComponentStatus = "unavailable"
    present: bool
    coordinate_set: CoordinateSet | None = None
    modeling_approach: Literal["co_folding", "docking"] | None = None
    pairwise_confidence_matrix_uri: str | None = Field(
        default=None,
        description="Reference to a PAE-like NxN matrix, stored as an object "
        "rather than inlined (may be large for long sequences).",
    )
    pairwise_confidence_summary: FieldConfidence | None = None
    modeling_method: str | None = Field(default=None, description="Modeling engine and version.")


class InterfaceAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: CanonicalComponentStatus = "unavailable"
    present: bool
    provenance: dict[str, Any] | None = None
    contact_residues: dict[str, list[int]] = Field(
        default_factory=dict, description="partner_id -> list of residue indices."
    )
    interaction_types: list[InteractionType] = Field(default_factory=list)
    buried_surface_area: float | None = Field(default=None, description="Angstrom^2.")
    shape_complementarity: float | None = None


class StructuralConfidenceSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    structural_tier: FieldConfidence
    interface_tier: FieldConfidence | None = None
    aggregate_note: str | None = None


class CanonicalStructuralConfidenceComponent(BaseModel):
    model_config = ConfigDict(extra="allow")

    status: CanonicalComponentStatus = Field(
        description=(
            "Component evidence state. not_applicable is used when the component is outside "
            "the requested analysis scope, e.g. no target for complex prediction."
        )
    )
    confidence: CanonicalConfidenceLabel = Field(
        description="Component confidence label on the canonical five-tier scale."
    )
    score: int | None = Field(
        default=None,
        ge=0,
        le=100,
        description="Deterministic component score when evidence is available; null otherwise.",
    )
    reason_code: str | None = Field(
        default=None,
        description="Machine-readable reason when the component is unavailable or not applicable.",
    )


class CanonicalStructuralConfidenceProvenance(BaseModel):
    model_config = ConfigDict(extra="allow")

    generator: Literal["structural_service"] | None = None
    provider: str | None = None
    model_id: str | None = None
    model_version: str | None = None
    schema_version: str | None = None
    generated_at: str | None = None
    calculator_version: str
    calculator: Literal["structural_confidence_aggregator"]
    ruleset_version: str
    deterministic: bool


class InterfaceConfidenceProvenance(BaseModel):
    model_config = ConfigDict(extra="allow")

    generator: Literal["structural_service"] | None = None
    provider: str | None = None
    model_id: str | None = None
    model_version: str | None = None
    schema_version: str | None = None
    generated_at: str | None = None
    calculator_version: str
    calculator: Literal["interface_confidence_aggregator"]
    ruleset_version: str
    deterministic: bool


class InterfaceConfidenceSummary(BaseModel):
    model_config = ConfigDict(extra="allow")

    status: CanonicalConfidenceStatus
    overall_confidence: CanonicalConfidenceLabel
    overall_score: int | None = Field(default=None, ge=0, le=100)
    analysis_scope: Literal["peptide_target_interface"]
    interface_available: bool | None = None
    reason_code: str | None = None
    binding_interface_confidence: CanonicalStructuralConfidenceComponent | None = None
    buried_surface_confidence: CanonicalStructuralConfidenceComponent | None = None
    interaction_confidence: CanonicalStructuralConfidenceComponent | None = None
    pose_consistency_confidence: CanonicalStructuralConfidenceComponent | None = None
    confidence_drivers: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    provenance: InterfaceConfidenceProvenance


class CanonicalStructuralConfidenceSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: CanonicalConfidenceStatus = Field(
        description="Overall aggregation state; available can be based on isolated evidence alone."
    )
    overall_confidence: CanonicalConfidenceLabel = Field(
        description="Overall structural confidence label after deterministic weighting and caps."
    )
    overall_score: int | None = Field(
        default=None,
        ge=0,
        le=100,
        description="Weighted deterministic structural score; null when insufficient evidence exists.",
    )
    evidence_quality: CanonicalEvidenceQuality = Field(
        description="Quality of evidence supporting the overall score."
    )
    analysis_scope: CanonicalAnalysisScope = Field(
        description="Scope actually supported by available evidence."
    )
    isolated_structure_confidence: CanonicalStructuralConfidenceComponent
    geometry_confidence: CanonicalStructuralConfidenceComponent
    feasibility_confidence: CanonicalStructuralConfidenceComponent
    target_confidence: CanonicalStructuralConfidenceComponent
    complex_confidence: CanonicalStructuralConfidenceComponent
    interface_confidence: CanonicalStructuralConfidenceComponent
    confidence_drivers: list[str] = Field(
        default_factory=list,
        description="Human-readable evidence drivers that most influenced the score.",
    )
    warnings: list[str] = Field(
        default_factory=list,
        description=(
            "Informational caveats. Provider unavailability, missing interface evidence, "
            "not-requested PDB output, and absent target context are warnings rather than "
            "fabricated low-confidence values."
        ),
    )
    provenance: CanonicalStructuralConfidenceProvenance


class StructuralEvidenceObjectProvenance(BaseModel):
    model_config = ConfigDict(extra="allow")

    generator: Literal["structural_service", "structural_evidence_builder"]
    provider: str | None = None
    model_id: str | None = None
    model_version: str | None = None
    schema_version: str | None = None
    generated_at: str | None = None
    version: Literal["1.0.0"]
    deterministic: bool


class StructuralEvidenceKnownLimitation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    description: str


class StructuralEvidenceObject(BaseModel):
    """Final structural payload consumed by downstream decision and reporting."""

    model_config = ConfigDict(extra="forbid")

    status: StructuralEvidenceObjectStatus
    analysis_scope: CanonicalAnalysisScope
    generated_by: Literal["structural_service"]
    schema_version: Literal["1.0.0"]
    validation_status: StructuralEvidenceValidationStatus
    known_limitations: list[StructuralEvidenceKnownLimitation] = Field(default_factory=list)
    isolated_structure: dict[str, Any] | None = Field(
        description="Existing isolated_structure output, preserved without recomputation."
    )
    target_resolution: dict[str, Any] | None = Field(
        description="Existing target_resolution output, preserved without recomputation."
    )
    strategy_selection: dict[str, Any] | None = Field(
        description="Existing strategy_selection output, preserved without recomputation."
    )
    complex_prediction: dict[str, Any] | None = Field(
        description="Existing complex_prediction output, preserved without recomputation."
    )
    interface_analysis: dict[str, Any] | None = Field(
        description="Existing interface_analysis output, preserved without recomputation."
    )
    interface_confidence_summary: dict[str, Any] | None = Field(
        description="Existing interface_confidence_summary output, preserved without recomputation."
    )
    structural_confidence_summary: dict[str, Any] | None = Field(
        description="Existing structural_confidence_summary output, preserved without recomputation."
    )
    provenance: StructuralEvidenceObjectProvenance


class StructuralEvidence(EvidenceObjectBase):
    """Structural Evidence Object -- Structural Biology Service Spec §14.
    Published per peptide, or per peptide-target pair where applicable."""

    EVIDENCE_TYPE: ClassVar[str] = "structural"
    PRODUCING_SERVICE: ClassVar[str] = "structural-biology-service"

    peptide_object_reference: uuid.UUID
    target_reference: uuid.UUID | None = Field(
        default=None, description="None => 'not_applicable' per §14."
    )
    structural_classification: StructuralClassification
    isolated_structure: IsolatedStructure
    complex_prediction: ComplexPrediction
    interface_analysis: InterfaceAnalysis
    provenance: StructuralProvenance
    confidence_summary: StructuralConfidenceSummary
    structural_confidence_summary: CanonicalStructuralConfidenceSummary | None = Field(
        default=None,
        description=(
            "Canonical Task 23 structural confidence aggregation. Additive field; the legacy "
            "confidence_summary remains unchanged for backward compatibility."
        ),
    )
    interface_confidence_summary: InterfaceConfidenceSummary | None = Field(
        default=None,
        description=(
            "Canonical Task 24 peptide-target interface confidence aggregation. Additive field; "
            "does not infer interface evidence from isolated peptide structure."
        ),
    )
    structural_evidence: StructuralEvidenceObject | None = Field(
        default=None,
        description=(
            "Canonical Task 25 final structural evidence payload. Additive field that "
            "aggregates existing structural outputs without recomputing scientific values."
        ),
    )
